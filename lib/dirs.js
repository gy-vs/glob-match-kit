'use strict';

const parse = require('./parse');
const constants = require('./constants');
const utils = require('./utils');

/**
 * Directory reachability support.
 *
 * `picomatch.dirMatcher()` (see lib/picomatch.js) returns a function
 * that answers: "given a directory relative to the search root, is it
 * possible that a path matched by one of the globs lives inside it?"
 *
 * The matcher is an over-approximation: it never returns false when a
 * matching path exists under the directory, but it may return true when
 * none exists.
 *
 * Boundary model
 * --------------
 * Each pattern is parsed once, at creation time, into a set of boundary
 * regular expressions. Every regex is fully anchored (`^...$`) and
 * represents a position where the pattern can "pause" at a directory:
 *
 *   - exact boundaries match the directory at a fixed segment boundary
 *     of the pattern;
 *   - continuation boundaries match the directory at a crossing
 *     construct (a globstar, a slash-spanning negated extglob, a
 *     bash-mode star, a slash-capable bracket class), where the pattern
 *     may skip any number of intermediate segments.
 */

const isObject = val => val && typeof val === 'object' && !Array.isArray(val);

/**
 * Count regex groups that are still open in a source fragment.
 * Character classes are skipped.
 */

const openParenCount = src => {
  let depth = 0;
  let inClass = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '[' && !inClass) {
      inClass = true;
      continue;
    }

    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }

    if (inClass) continue;

    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
  }

  return depth;
};

const closeGroups = src => {
  const depth = openParenCount(src);
  return depth > 0 ? src + ')'.repeat(depth) : src;
};

const makeBoundary = (exact, continuation) => ({
  exact,
  continuation: continuation || exact
});

/**
 * Build the globstar body source exactly the way `parse()` does.
 */

const globstarSource = options => {
  const chars = constants.globChars(options.windows);
  return `(?:(?:(?!${chars.START_ANCHOR}${options.dot ? chars.DOTS_SLASH : chars.DOT_LITERAL}).)*?)`;
};

/**
 * Continuation regex source at a crossing construct.
 *
 * After `base` the pattern may skip any number of path segments before
 * its fixed suffix, so the reachable directories are the base itself
 * and every descendant of it.
 */

const anyDepthContinuation = (source, options) => {
  const base = closeGroups(source);
  const { SLASH_LITERAL: SL } = constants.globChars(options.windows);

  if (base === '') {
    // A leading globstar only reaches non-dot relative directories
    // unless the `dot` option is enabled.
    if (options.dot === true) {
      return '.*$';
    }

    const { NO_DOT, DOTS_SLASH, START_ANCHOR } = constants.globChars(options.windows);
    return `(?:${NO_DOT}(?:(?!${START_ANCHOR}${DOTS_SLASH}).)*$)`;
  }

  return `(?:${base}$|${base}${SL})`;
};

/**
 * Find boundaries by walking the tokens of the general parser.
 */

const boundariesFromTokens = (state, options) => {
  const boundaries = [];
  const extglobs = [];
  const { SLASH_LITERAL } = constants.globChars(options.windows);
  const tokens = state.tokens;
  let output = '';

  // Output captured right before the most recent slash token, and a
  // flag indicating that the following token is that slash's globstar.
  let preSlashOutput = '';
  let slashOpensGlobstar = false;

  // When the pattern starts with a leading globstar (`**/...`), this is
  // the regex source for the BOS assertion plus the globstar group.
  // Boundaries past that point are duplicated with the prefix removed,
  // which covers the globstar's zero-segments alternative.
  let leadingPrefix = null;

  const insideNegateExtglob = () => extglobs.some(extglob => extglob.type === 'negate');

  const addExact = source => {
    boundaries.push(makeBoundary(`${closeGroups(source)}$`));

    if (leadingPrefix !== null
        && !insideNegateExtglob()
        && source.startsWith(leadingPrefix)) {
      const stripped = source.slice(leadingPrefix.length);
      boundaries.push(makeBoundary(`${closeGroups(stripped)}$`));
    }
  };

  const addAnyDepth = source => {
    boundaries.push(makeBoundary(`${closeGroups(source)}$`, anyDepthContinuation(source, options)));
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const isLeadingGlobstar = token.type === 'globstar'
      && tokens.slice(0, index).every(t => t.type === 'bos');

    if (token.type === 'slash') {
      for (const extglob of extglobs) {
        extglob.hasSlash = true;
      }

      preSlashOutput = output;
      slashOpensGlobstar = (tokens[index + 1] && tokens[index + 1].type === 'globstar');

      // Exact boundaries are emitted at every separator, including
      // separators inside extglob bodies. A boundary inside a negated
      // body is inherently imprecise (it may be a false positive), but
      // it is never unsound because the pre-extglob prefix boundary is
      // also always present.
      addExact(output);

      if (token.output) {
        const slashIndex = token.output.indexOf(SLASH_LITERAL);
        if (slashIndex !== -1) {
          addExact(output + token.output.slice(0, slashIndex + SLASH_LITERAL.length));
        }
      }
    } else if (token.type === 'negate'
        || (token.extglob === true && token.type !== 'paren')) {
      extglobs.push({
        type: token.type,
        prefix: output,
        hasSlash: false,
        opened: false
      });
    }

    // A bracket class that can match a separator (e.g. an expanded
    // POSIX class such as `[[:punct:]]`) opens arbitrary descendants.
    // The crossing point is right before the class token, so the base
    // boundary uses the output accumulated up to now.
    if (token.type === 'bracket' && !insideNegateExtglob()) {
      const value = token.output != null ? token.output : token.value;
      if (value && value.replace(/\\\//g, '').includes('/')) {
        addAnyDepth(output);
      }
    }

    output += token.output != null ? token.output : token.value;
    if (token.suffix) output += token.suffix;

    if (token.type === 'paren') {
      const extglob = extglobs[extglobs.length - 1];

      if (token.value === '(' && extglob && !extglob.opened) {
        extglob.opened = true;
      } else if (token.value === ')' && token.extglob === true && extglob) {
        extglobs.pop();

        // A negate extglob is followed by an implicit tail matching
        // anything; whenever it can reach across separators (a slash in
        // its body, a BOS position, or bash mode where `*` crosses
        // separators), arbitrary descendant depths are reachable.
        if (extglob.type === 'negate'
            && (extglob.hasSlash || extglob.prefix === '' || options.bash === true)) {
          const base = closeGroups(extglob.prefix);
          const { SLASH_LITERAL: SL } = constants.globChars(options.windows);
          const GS = globstarSource(options);
          // The extglob's globstar tail extends the current segment as
          // well as deeper segments, so reachable directories are the
          // base and anything that begins with it.
          const continuation = base === ''
            ? '.*$'
            : `(?:${base}$|${base}${GS}(?:${SL}|$)|${base}${SL})`;
          boundaries.push(makeBoundary(`${base}$`, continuation));
        }
      }
    }

    if (token.type === 'globstar' && !insideNegateExtglob()) {
      if (isLeadingGlobstar) {
        // At this point `output` already contains the BOS no-dot
        // assertion and the leading globstar group. Record the whole
        // construct so fixed-suffix boundaries can be duplicated with
        // it removed (the zero-segments alternative).
        leadingPrefix = output;

        let descendant;
        if (options.dot === true) {
          descendant = '.*$';
        } else {
          // A leading globstar only reaches directories whose very
          // first segment does not start with a dot; deeper dot
          // segments are allowed as false positives at worst.
          const { DOT_LITERAL } = constants.globChars(options.windows);
          descendant = `(?:(?!${DOT_LITERAL}).*)$`;
        }

        boundaries.push(makeBoundary('$', descendant));
      } else {
        addAnyDepth(slashOpensGlobstar ? preSlashOutput : output);
      }
    }

    // In bash mode a regular `star` token crosses separators.
    if (token.type === 'star' && options.bash === true && !insideNegateExtglob()) {
      addAnyDepth(output);
    }
  }

  return boundaries;
};

/**
 * Find boundaries by scanning a fastpath-generated regex source. The
 * fastpaths use a small, fixed set of templates, so the structure can be
 * scanned character by character.
 */

const boundariesFromSource = (source, options) => {
  const boundaries = [];
  const { SLASH_LITERAL } = constants.globChars(options.windows);
  const GS = globstarSource(options);
  const windowsSlash = '[\\\\/]';

  // In bash mode a single star matches across separators as `.*?`.
  const anyDepthBodies = options.bash === true ? [GS, '.*?'] : [GS];

  let inClass = false;
  let escaped = false;
  let i = 0;

  const addExact = end => {
    const src = closeGroups(source.slice(0, end));
    if (src !== '') boundaries.push(makeBoundary(`${src}$`));
  };

  const addAnyDepth = end => {
    const src = source.slice(0, end);
    boundaries.push(makeBoundary(`${closeGroups(src)}$`, anyDepthContinuation(src, options)));
  };

  while (i < source.length) {
    const ch = source[i];

    if (!inClass) {
      const body = anyDepthBodies.find(value => source.startsWith(value, i));
      if (body) {
        addAnyDepth(i + body.length);
        i += body.length;
        continue;
      }
    }

    if (escaped) {
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      if (!options.windows && source.startsWith(SLASH_LITERAL, i)) {
        addExact(i);
        addExact(i + SLASH_LITERAL.length);
        i += SLASH_LITERAL.length;
        continue;
      }

      escaped = true;
      i++;
      continue;
    }

    if (ch === '[') {
      if (options.windows && source.startsWith(windowsSlash, i)) {
        addExact(i);
        addExact(i + windowsSlash.length);
        i += windowsSlash.length;
        continue;
      }

      inClass = true;
      i++;
      continue;
    }

    if (ch === ']') {
      inClass = false;
      i++;
      continue;
    }

    // An expanded POSIX class may match a separator.
    if (inClass && ch === '/') {
      addAnyDepth(i + 1);
    }

    i++;
  }

  return boundaries;
};

/**
 * Compile a single pattern into the structures needed by the directory
 * matcher.
 */

const compilePattern = (picomatch, input, options = {}) => {
  const isState = isObject(input) && input.tokens && input.input;
  const pattern = isState ? input.input : input;

  if (pattern === '' || typeof pattern !== 'string') {
    throw new TypeError('Expected pattern to be a non-empty string');
  }

  const state = isState
    ? input
    : parse(pattern, { ...options, fastpaths: false });

  // The complete, anchored matcher regex; created exactly the way the
  // main matcher creates it (fastpaths included).
  const regex = isState
    ? picomatch.compileRe(input, options)
    : picomatch.makeRe(pattern, options);

  const usesFastpath = !isState
    && options.fastpaths !== false
    && (pattern[0] === '*' || pattern[0] === '.');

  let boundaries;
  if (usesFastpath) {
    const fastpath = parse.fastpaths(pattern, options);
    boundaries = fastpath
      ? boundariesFromSource(fastpath, options)
      : boundariesFromTokens(state, options);
  } else {
    boundaries = boundariesFromTokens(state, options);
  }

  const prefixes = [];

  for (const boundary of boundaries) {
    try {
      prefixes.push({
        exact: picomatch.toRegex(`^(?:${boundary.exact})`, options),
        continuation: picomatch.toRegex(`^(?:${boundary.continuation})`, options)
      });
    } catch (err) {
      if (options.debug === true) throw err;
      // Dropping an invalid boundary only reduces pruning; it can never
      // cause a directory to be skipped wrongly.
    }
  }

  return { negated: state.negated === true, regex, prefixes };
};

/**
 * Creates a directory matcher from one or more glob patterns.
 *
 * The returned function takes a directory path (relative to the search
 * root) and returns `true` when the directory may contain a path
 * matched by the given globs, and `false` when it is guaranteed not to.
 *
 * False negatives are impossible; false positives are allowed.
 *
 * ```js
 * const picomatch = require('picomatch');
 * const hasMatchUnder = picomatch.dirMatcher('src/**');
 *
 * console.log(hasMatchUnder('src'));      //=> true
 * console.log(hasMatchUnder('src/foo'));  //=> true
 * console.log(hasMatchUnder('docs'));     //=> false
 * ```
 * @name dirMatcher
 * @param {String|Array} `globs` One or more glob patterns.
 * @param {Object=} `options`
 * @return {Function} Returns a directory matcher function.
 * @api public
 */

const dirMatcher = picomatch => (globs, options) => {
  if (Array.isArray(globs)) {
    const fns = globs.map(input => dirMatcher(picomatch)(input, options));
    return dir => {
      for (const isReachable of fns) {
        if (isReachable(dir)) return true;
      }
      return false;
    };
  }

  const opts = options || {};

  // When the complete matcher only looks at the basename, a matching
  // file can live inside any directory.
  if (opts.matchBase === true || opts.basename === true) {
    return () => true;
  }

  let pattern = globs;
  if (isObject(globs) && globs.tokens && globs.input) {
    pattern = globs.input;
  }

  const compiled = compilePattern(picomatch, globs, opts);
  const posix = opts.windows === true;
  const format = opts.format || (posix ? utils.toPosixSlashes : null);

  return input => {
    if (typeof input !== 'string') {
      throw new TypeError('Expected input to be a string');
    }

    // A negated pattern matches everything except a specific set; a
    // directory can always contain paths outside that set, so it is
    // always reachable.
    if (compiled.negated) {
      return true;
    }

    let dir = input;

    // trailing separators describe the same directory
    dir = posix ? dir.replace(/[\\/]+$/, '') : dir.replace(/\/+$/, '');

    // the search root itself and current-directory references
    if (dir === '' || dir === '.' || dir === './') {
      return true;
    }

    // Use the same path formatting as the main matcher so that
    // backslashes are treated as separators in windows mode.
    const value = format ? format(dir) : dir;

    // the directory path itself may be exactly what the pattern matches
    if (picomatch.test(value, compiled.regex, opts, { glob: pattern, posix }).isMatch) {
      return true;
    }

    // ...or it may be a boundary prefix that the pattern can continue
    // from deeper inside the directory
    for (const prefix of compiled.prefixes) {
      if (prefix.exact.test(value) || prefix.continuation.test(value)) {
        return true;
      }
    }

    return false;
  };
};

module.exports = picomatch => dirMatcher(picomatch);
