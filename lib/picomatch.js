'use strict';

const scan = require('./scan');
const parse = require('./parse');
const utils = require('./utils');
const constants = require('./constants');
const isObject = val => val && typeof val === 'object' && !Array.isArray(val);

/**
 * Creates a matcher function from one or more glob patterns. The
 * returned function takes a string to match as its first argument,
 * and returns true if the string is a match. The returned matcher
 * function also takes a boolean as the second argument that, when true,
 * returns an object with additional information.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch(glob[, options]);
 *
 * const isMatch = picomatch('*.!(*a)');
 * console.log(isMatch('a.a')); //=> false
 * console.log(isMatch('a.b')); //=> true
 * ```
 * @name picomatch
 * @param {String|Array} `globs` One or more glob patterns.
 * @param {Object=} `options`
 * @return {Function=} Returns a matcher function.
 * @api public
 */

const picomatch = (glob, options, returnState = false) => {
  if (Array.isArray(glob)) {
    const fns = glob.map(input => picomatch(input, options, returnState));
    const arrayMatcher = str => {
      for (const isMatch of fns) {
        const state = isMatch(str);
        if (state) return state;
      }
      return false;
    };
    return arrayMatcher;
  }

  const isState = isObject(glob) && glob.tokens && glob.input;

  if (glob === '' || (typeof glob !== 'string' && !isState)) {
    throw new TypeError('Expected pattern to be a non-empty string');
  }

  const opts = options || {};
  const posix = opts.windows;
  const regex = isState
    ? picomatch.compileRe(glob, options)
    : picomatch.makeRe(glob, options, false, true);

  const state = regex.state;
  delete regex.state;

  let isIgnored = () => false;
  if (opts.ignore) {
    const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
    isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
  }

  const matcher = (input, returnObject = false) => {
    const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
    const result = { glob, state, regex, posix, input, output, match, isMatch };

    if (typeof opts.onResult === 'function') {
      opts.onResult(result);
    }

    if (isMatch === false) {
      result.isMatch = false;
      return returnObject ? result : false;
    }

    if (isIgnored(input)) {
      if (typeof opts.onIgnore === 'function') {
        opts.onIgnore(result);
      }
      result.isMatch = false;
      return returnObject ? result : false;
    }

    if (typeof opts.onMatch === 'function') {
      opts.onMatch(result);
    }
    return returnObject ? result : true;
  };

  if (returnState) {
    matcher.state = state;
  }

  return matcher;
};

/**
 * Creates a "directory matcher" function from one or more glob patterns.
 *
 * The returned function takes the relative path of a directory and returns
 * `true` when the directory itself, or any of its descendants, might match
 * one of the given patterns (so the directory should be entered during a
 * traversal), and `false` when no match can ever exist inside the directory
 * (so it can be safely pruned).
 *
 * The result is guaranteed not to produce false negatives: if a path that
 * matches the patterns exists inside the given directory, the function always
 * returns `true`. False positives (returning `true` when no match exists) are
 * possible and acceptable, since they only cause extra directories to be
 * visited. Patterns are compiled once, when the matcher is created.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.dirMatcher(glob[, options]);
 *
 * const isRelevant = picomatch.dirMatcher('src/**');
 * console.log(isRelevant('docs')); //=> false
 * console.log(isRelevant('src'));  //=> true
 * ```
 * @name dirMatcher
 * @param {String|Array} `globs` One or more glob patterns.
 * @param {Object=} `options`
 * @return {Function} Returns a directory matcher function.
 * @api public
 */

picomatch.dirMatcher = (glob, options) => {
  if (Array.isArray(glob)) {
    const fns = glob.map(input => picomatch.dirMatcher(input, options));
    return dir => {
      for (const isMatch of fns) {
        if (isMatch(dir)) return true;
      }
      return false;
    };
  }

  if (glob === '' || (typeof glob !== 'string' && !(isObject(glob) && glob.tokens && glob.input))) {
    throw new TypeError('Expected pattern to be a non-empty string');
  }

  const opts = options || {};
  const win = opts.windows === true;

  // Patterns matched against a basename (`matchBase`/`basename`) or used as a
  // substring search (`contains`) can match at any depth, so every directory
  // might contain a match.
  if (opts.matchBase === true || opts.basename === true || opts.contains === true) {
    return () => true;
  }

  let pattern = typeof glob === 'string' ? glob : glob.input;

  // Mirror the leading `./` stripping done by the parser: `removePrefix`
  // strips one `./`, and tokenizing strips another for every consecutive
  // `./` prefix.
  while (pattern.startsWith('./')) {
    pattern = pattern.slice(2);
  }

  // Leading negation: a negated pattern (e.g. `!foo`) matches everything
  // except `foo`, and at any depth one can always find a path it matches.
  // Replicates the `negate()` logic in lib/parse.js.
  if (opts.nonegate !== true && pattern[0] === '!') {
    let count = 0;
    while (pattern[count] === '!'
      && !(pattern[count + 1] === '(' && pattern[count + 2] !== '?')) {
      count++;
    }
    if (count > 0 && count % 2 === 1) {
      return () => true;
    }
    pattern = pattern.slice(count);
  }

  // Split the pattern into top-level path segments, keeping track of slashes
  // that occur inside braces or extglob groups (they span multiple segments
  // within a single segment of the pattern).
  const segments = [];
  let current = '';
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  let quotes = 0;
  let escaped = false;
  let groupSlash = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];

    if (escaped) {
      escaped = false;

      // In the parser, an escaped slash (`\/`) is a path separator unless
      // the `bash` option is enabled (in bash mode the backslash is kept).
      // The backslash itself is only an escape marker, so it is dropped.
      if (ch === '/' && opts.bash !== true) {
        current = current.slice(0, -1);

        if (braces === 0 && parens === 0) {
          segments.push({ value: current, groupSlash });
          current = '';
          groupSlash = false;
        } else {
          groupSlash = true;
          current += ch;
        }
        continue;
      }

      current += ch;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === '"') {
      quotes = quotes === 0 ? 1 : 0;
      current += ch;
      continue;
    }

    if (quotes === 0) {
      if (ch === '[') {
        brackets++;
      } else if (ch === ']' && brackets > 0) {
        brackets--;
      } else if (brackets === 0) {
        if (ch === '{') {
          braces++;
        } else if (ch === '}' && braces > 0) {
          braces--;
        } else if (ch === '(') {
          parens++;
        } else if (ch === ')' && parens > 0) {
          parens--;
        } else if (ch === '/' && braces === 0 && parens === 0) {
          segments.push({ value: current, groupSlash });
          current = '';
          groupSlash = false;
          continue;
        } else if (ch === '/' && (braces > 0 || parens > 0)) {
          groupSlash = true;
        }
      }
    }

    current += ch;
  }

  segments.push({ value: current, groupSlash });

  // Fallback probe strings for compiled regexes that span path separators
  // without an explicit globstar token (e.g. a negated pattern compiled to
  // `^(?!...).*$`).
  const crossProbes = ['x/x', 'x/x/x', 'aa/aa', 'a/b/c'];

  const tokens = segments.map(segment => {
    const value = segment.value;

    if (value === '**') {
      // Bare globstar; blocked from consuming dot-prefixed segments unless
      // the `dot` option is enabled.
      return { type: 'gstar' };
    }

    if (value === '') {
      // Empty segment from a leading or duplicate slash; it can only match
      // an empty input segment.
      return { type: 'empty' };
    }

    const regex = picomatch.makeRe(value, opts);

    // Parse the segment to see whether the compiler emitted a globstar
    // token (it may have a fixed prefix, e.g. `foo?(x)**`, which a fixed
    // probe string could never reach). In bash mode every star compiles to
    // a path-spanning `.*?`.
    const parsed = picomatch.parse(value, { ...opts, fastpaths: false });
    const hasGlobstarToken = parsed.tokens.some(token => {
      return token.type === 'globstar'
        || (opts.bash === true && token.type === 'star');
    });

    const spans = parsed.negated === true
      || hasGlobstarToken
      || crossProbes.some(probe => regex.test(probe));

    if (spans) {
      // Globstar-like, but not a bare `**` segment, so we cannot prove the
      // dot restrictions of a bare globstar apply. Treat it as unrestricted:
      // this may visit a few extra directories, but can never skip a
      // directory that contains a match.
      return { type: 'group' };
    }

    if (segment.groupSlash) {
      // Brace/extglob group containing a literal slash (e.g. `{x,y/z}`).
      return { type: 'group' };
    }

    return {
      type: 'single',
      regex,
      canBeEmpty: regex.test(''),
      // A bare `*` compiles with a `(?=.)` lookahead, so it can expand to an
      // empty segment when the pattern continues with another segment (the
      // lookahead then sees the following slash).
      canBeEmptyWithSlash: regex.test('/')
    };
  });

  // Globstar-like tokens may match zero segments; expose those alignments.
  const expandZeroWidth = set => {
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of [...set]) {
        if (i < tokens.length) {
          const type = tokens[i].type;
          if ((type === 'gstar' || type === 'group') && !set.has(i + 1)) {
            set.add(i + 1);
            grew = true;
          }
        }
      }
    }
  };

  return dir => {
    if (typeof dir !== 'string') {
      throw new TypeError('Expected input to be a string');
    }

    let input = dir;

    if (win) {
      input = utils.toPosixSlashes(input);
    }

    while (input === '.' || input.startsWith('./')) {
      input = input === '.' ? '' : input.slice(2);
    }

    const trailingSlash = input.length > 1 && input.endsWith('/');

    if (trailingSlash) {
      input = input.slice(0, -1);
    }

    // Keep empty segments: picomatch does not collapse duplicate or leading
    // slashes, so an empty segment is a real segment that must line up with
    // an empty segment in the pattern. A literal `.` segment (other than the
    // leading `./` already stripped above) is kept as-is too.
    const parts = input === '' || input === '/'
      ? []
      : input.split('/');

    // Dynamic programming over path depth: `reachable` is the set of token
    // indices that can be aligned with the current position in the directory.
    let reachable = new Set([0]);
    expandZeroWidth(reachable);

    for (const part of parts) {
      const next = new Set();
      const dotPart = part[0] === '.';

      for (const i of reachable) {
        if (i >= tokens.length) continue;

        const token = tokens[i];

        if (token.type === 'gstar') {
          // Unless dot handling forbids this segment, the globstar consumes
          // it and either stays active (more segments may follow) or ends.
          if (opts.dot === true || !dotPart) {
            next.add(i);
            next.add(i + 1);
          }
        } else if (token.type === 'group') {
          next.add(i);
          next.add(i + 1);
        } else if (token.type === 'empty') {
          // An empty pattern segment (duplicate/leading slash) only matches
          // an empty input segment.
          if (part === '') {
            next.add(i + 1);
          }
        } else if (token.type === 'single') {
          if (token.regex.test(part)) {
            next.add(i + 1);
          } else if (part === '' && token.canBeEmptyWithSlash
              && (i + 1 < tokens.length || trailingSlash)) {
            // A bare star can expand to an empty segment when a slash follows
            // in the pattern (another segment) or the input ended with one.
            next.add(i + 1);
          }
        }
      }

      // Zero-width expansion of globstar-like tokens at newly reached
      // positions, so they may consume zero segments as well.
      expandZeroWidth(next);

      reachable = next;
      if (reachable.size === 0) return false;
    }

    for (const i of reachable) {
      // The directory itself matches when every remaining token is
      // zero-width (globstar/group, or a single segment capable of matching
      // a string with zero width).
      let selfMatch = true;

      for (let j = i; j < tokens.length; j++) {
        const token = tokens[j];
        if (token.type === 'gstar' || token.type === 'group') continue;
        // An empty segment matches a real empty input segment; a trailing
        // empty segment additionally requires the input to end with a slash.
        if (token.type === 'empty' && (j + 1 < tokens.length || trailingSlash)) continue;
        if (token.type === 'single' && token.canBeEmpty) continue;
        if (token.type === 'single' && token.canBeEmptyWithSlash
            && (j + 1 < tokens.length || trailingSlash)) continue;
        selfMatch = false;
        break;
      }

      if (selfMatch) return true;

      // Otherwise a descendant might match as long as pattern tokens remain:
      // a fixed suffix (`foo/bar.js`), a wildcard segment (`*`, `?`, ...), or
      // a globstar can all be satisfied by going one level deeper.
      if (i < tokens.length) return true;
    }

    return false;
  };
};

/**
 * Test `input` with the given `regex`. This is used by the main
 * `picomatch()` function to test the input string.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.test(input, regex[, options]);
 *
 * console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
 * // { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
 * ```
 * @param {String} `input` String to test.
 * @param {RegExp} `regex`
 * @return {Object} Returns an object with matching info.
 * @api public
 */

picomatch.test = (input, regex, options, { glob, posix } = {}) => {
  if (typeof input !== 'string') {
    throw new TypeError('Expected input to be a string');
  }

  if (input === '') {
    return { isMatch: false, output: '' };
  }

  const opts = options || {};
  const format = opts.format || (posix ? utils.toPosixSlashes : null);
  let match = input === glob;
  let output = (match && format) ? format(input) : input;

  if (match === false) {
    output = format ? format(input) : input;
    match = output === glob;
  }

  if (match === false || opts.capture === true) {
    if (opts.matchBase === true || opts.basename === true) {
      match = picomatch.matchBase(input, regex, options, posix);
    } else {
      match = regex.exec(output);
    }
  }

  return { isMatch: Boolean(match), match, output };
};

/**
 * Match the basename of a filepath.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.matchBase(input, glob[, options]);
 * console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
 * ```
 * @param {String} `input` String to test.
 * @param {RegExp|String} `glob` Glob pattern or regex created by [.makeRe](#makeRe).
 * @return {Boolean}
 * @api public
 */

picomatch.matchBase = (input, glob, options) => {
  const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
  return regex.test(utils.basename(input));
};

/**
 * Returns true if **any** of the given glob `patterns` match the specified `string`.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.isMatch(string, patterns[, options]);
 *
 * console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
 * console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
 * ```
 * @param {String|Array} str The string to test.
 * @param {String|Array} patterns One or more glob patterns to use for matching.
 * @param {Object} [options] See available [options](#options).
 * @return {Boolean} Returns true if any patterns match `str`
 * @api public
 */

picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);

/**
 * Parse a glob pattern to create the source string for a regular
 * expression.
 *
 * ```js
 * const picomatch = require('picomatch');
 * const result = picomatch.parse(pattern[, options]);
 * ```
 * @param {String} `pattern`
 * @param {Object} `options`
 * @return {Object} Returns an object with useful properties and output to be used as a regex source string.
 * @api public
 */

picomatch.parse = (pattern, options) => {
  if (Array.isArray(pattern)) return pattern.map(p => picomatch.parse(p, options));
  return parse(pattern, { ...options, fastpaths: false });
};

/**
 * Scan a glob pattern to separate the pattern into segments.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.scan(input[, options]);
 *
 * const result = picomatch.scan('!./foo/*.js');
 * console.log(result);
 * { prefix: '!./',
 *   input: '!./foo/*.js',
 *   start: 3,
 *   base: 'foo',
 *   glob: '*.js',
 *   isBrace: false,
 *   isBracket: false,
 *   isGlob: true,
 *   isExtglob: false,
 *   isGlobstar: false,
 *   negated: true }
 * ```
 * @param {String} `input` Glob pattern to scan.
 * @param {Object} `options`
 * @return {Object} Returns an object with
 * @api public
 */

picomatch.scan = (input, options) => scan(input, options);

/**
 * Compile a regular expression from the `state` object returned by the
 * [parse()](#parse) method.
 *
 * ```js
 * const picomatch = require('picomatch');
 * const state = picomatch.parse('*.js');
 * // picomatch.compileRe(state[, options]);
 *
 * console.log(picomatch.compileRe(state));
 * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
 * ```
 * @param {Object} `state`
 * @param {Object} `options`
 * @param {Boolean} `returnOutput` Intended for implementors, this argument allows you to return the raw output from the parser.
 * @param {Boolean} `returnState` Adds the state to a `state` property on the returned regex. Useful for implementors and debugging.
 * @return {RegExp}
 * @api public
 */

picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
  if (returnOutput === true) {
    return state.output;
  }

  const opts = options || {};
  const prepend = opts.contains ? '' : '^';
  const append = opts.contains ? '' : '$';

  let source = `${prepend}(?:${state.output})${append}`;
  if (state && state.negated === true) {
    source = `^(?!${source}).*$`;
  }

  const regex = picomatch.toRegex(source, options);
  if (returnState === true) {
    regex.state = state;
  }

  return regex;
};

/**
 * Create a regular expression from a parsed glob pattern.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.makeRe(state[, options]);
 *
 * const result = picomatch.makeRe('*.js');
 * console.log(result);
 * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
 * ```
 * @param {String} `state` The object returned from the `.parse` method.
 * @param {Object} `options`
 * @param {Boolean} `returnOutput` Implementors may use this argument to return the compiled output, instead of a regular expression. This is not exposed on the options to prevent end-users from mutating the result.
 * @param {Boolean} `returnState` Implementors may use this argument to return the state from the parsed glob with the returned regular expression.
 * @return {RegExp} Returns a regex created from the given pattern.
 * @api public
 */

picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
  if (!input || typeof input !== 'string') {
    throw new TypeError('Expected a non-empty string');
  }

  let parsed = { negated: false, fastpaths: true };

  if (options.fastpaths !== false && (input[0] === '.' || input[0] === '*')) {
    parsed.output = parse.fastpaths(input, options);
  }

  if (!parsed.output) {
    parsed = parse(input, options);
  }

  return picomatch.compileRe(parsed, options, returnOutput, returnState);
};

/**
 * Create a regular expression from the given regex source string.
 *
 * ```js
 * const picomatch = require('picomatch');
 * // picomatch.toRegex(source[, options]);
 *
 * const { output } = picomatch.parse('*.js');
 * console.log(picomatch.toRegex(output));
 * //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
 * ```
 * @param {String} `source` Regular expression source string.
 * @param {Object} `options`
 * @return {RegExp}
 * @api public
 */

picomatch.toRegex = (source, options) => {
  try {
    const opts = options || {};
    return new RegExp(source, opts.flags || (opts.nocase ? 'i' : ''));
  } catch (err) {
    if (options && options.debug === true) throw err;
    return /$^/;
  }
};

/**
 * Picomatch constants.
 * @return {Object}
 */

picomatch.constants = constants;

/**
 * Expose "picomatch"
 */

module.exports = picomatch;
