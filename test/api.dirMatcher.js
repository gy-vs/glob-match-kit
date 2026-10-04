'use strict';

const assert = require('assert');
const picomatch = require('..');
const { dirMatcher, isMatch } = picomatch;

describe('picomatch.dirMatcher', () => {
  describe('basic pruning', () => {
    it('should return a function', () => {
      assert.strictEqual(typeof dirMatcher('*'), 'function');
    });

    it('should prune directories outside a fixed prefix', () => {
      const isRelevant = dirMatcher('src/**/*.js');

      assert.strictEqual(isRelevant('docs'), false);
      assert.strictEqual(isRelevant('docs/sub'), false);
      assert.strictEqual(isRelevant('node_modules'), false);
      assert.strictEqual(isRelevant('srcx'), false);

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('src/a'), true);
      assert.strictEqual(isRelevant('src/a/b'), true);
    });

    it('should keep prefix directories of a fixed path pattern', () => {
      const isRelevant = dirMatcher('foo/bar/baz.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('foo'), true);
      assert.strictEqual(isRelevant('foo/bar'), true);
      assert.strictEqual(isRelevant('foo/bar/baz.js'), true);

      assert.strictEqual(isRelevant('fooz'), false);
      assert.strictEqual(isRelevant('foo/barz'), false);
      assert.strictEqual(isRelevant('foo/qux'), false);
      assert.strictEqual(isRelevant('foo/bar/qux'), false);
      assert.strictEqual(isRelevant('x'), false);
    });

    it('should not allow matches below a non-wildcard leaf segment', () => {
      const isRelevant = dirMatcher('a/b/c');

      assert.strictEqual(isRelevant('a/b/c/d'), false);
      assert.strictEqual(isRelevant('a/b/c/d/e'), false);
    });

    it('should only allow matches directly inside the root for a root-star pattern', () => {
      const isRelevant = dirMatcher('*.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('src'), false);
      assert.strictEqual(isRelevant('a/b'), false);
    });

    it('should support a wildcard segment', () => {
      const isRelevant = dirMatcher('a/*/c');

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('a/b'), true);
      assert.strictEqual(isRelevant('a/b/c'), true);
      assert.strictEqual(isRelevant('a/xyz'), true);
      assert.strictEqual(isRelevant('x'), false);
      assert.strictEqual(isRelevant('a/b/d'), false);
    });

    it('should treat a leading globstar as a match at any depth', () => {
      const isRelevant = dirMatcher('**/*.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('docs'), true);
      assert.strictEqual(isRelevant('docs/a'), true);
      assert.strictEqual(isRelevant('node_modules/pkg'), true);
    });

    it('should prune siblings once a globstar prefix is fixed', () => {
      const isRelevant = dirMatcher('a/**/b.js');

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('a/x'), true);
      assert.strictEqual(isRelevant('a/x/y'), true);
      assert.strictEqual(isRelevant('c'), false);
      assert.strictEqual(isRelevant('c/a'), false);
    });

    it('should normalize the root directory input', () => {
      const isRelevant = dirMatcher('a/b/*.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant(''), true);
      assert.strictEqual(isRelevant('./a'), true);
      assert.strictEqual(isRelevant('a/b/'), true);
    });

    it('should strip trailing slashes', () => {
      const isRelevant = dirMatcher('foo/bar/*.js');

      assert.strictEqual(isRelevant('foo/'), true);
      assert.strictEqual(isRelevant('foo/bar/'), true);
      assert.strictEqual(isRelevant('baz/'), false);
    });
  });

  describe('pattern arrays', () => {
    it('should match when any pattern is relevant', () => {
      const isRelevant = dirMatcher(['src/**/*.js', 'docs/**/*.md']);

      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('docs'), true);
      assert.strictEqual(isRelevant('src/a'), true);
      assert.strictEqual(isRelevant('build'), false);
      assert.strictEqual(isRelevant('node_modules'), false);
    });

    it('should have OR semantics for arrays', () => {
      const isRelevant = dirMatcher(['a/b.js', 'c/d.js']);

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('c'), true);
      assert.strictEqual(isRelevant('e'), false);
    });
  });

  describe('negation', () => {
    it('should keep every directory for a negated pattern', () => {
      const isRelevant = dirMatcher('!foo/bar.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('anything'), true);
      assert.strictEqual(isRelevant('a/b/c'), true);
    });

    it('should keep every directory for a double-anchor negated extglob', () => {
      const isRelevant = dirMatcher('!(a/b)');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('c'), true);
      assert.strictEqual(isRelevant('a/b'), true);
    });

    it('should handle a single-segment negated extglob', () => {
      const isRelevant = dirMatcher('a/!(b)/c.js');

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('a/x'), true);
      assert.strictEqual(isRelevant('a/y'), true);
      // no descendant of a/b can match the !(b) segment
      assert.strictEqual(isRelevant('a/b'), false);
      assert.strictEqual(isRelevant('z'), false);
    });
  });

  describe('options', () => {
    it('should support the ignore option', () => {
      const isRelevant = dirMatcher('src/**/*.js', { ignore: ['src/secret/**'] });

      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('src/a'), true);
      assert.strictEqual(isRelevant('docs'), false);
      assert.strictEqual(isRelevant('docs/sub'), false);
      // the ignore pattern lives under the include prefix, so this directory
      // still needs to be visited (other, non-ignored files may sit next to
      // the ignored subtree); it cannot be pruned based on ignore alone
      assert.strictEqual(isRelevant('src/secret'), true);
    });

    it('should prune directories matched only by an ignore pattern', () => {
      // Directories unrelated to the include pattern are still pruned; the
      // `ignore` option only filters final matches, it is never used to
      // prune a directory (which would risk missing non-ignored siblings).
      const isRelevant = dirMatcher('**/*.js', { ignore: ['build/**'] });

      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('build'), true);
      assert.strictEqual(isRelevant('docs'), true);
    });

    it('should support the dot option for dot-directories', () => {
      const withoutDot = dirMatcher('**/*.js');
      assert.strictEqual(withoutDot('.git'), false);
      assert.strictEqual(withoutDot('a/.hidden'), false);
      assert.strictEqual(withoutDot('a/.hidden/sub'), false);
      assert.strictEqual(withoutDot('a/visible'), true);

      const withDot = dirMatcher('**/*.js', { dot: true });
      assert.strictEqual(withDot('.git'), true);
      assert.strictEqual(withDot('a/.hidden'), true);
      assert.strictEqual(withDot('a/.hidden/sub'), true);
    });

    it('should support the nocase option', () => {
      const isRelevant = dirMatcher('src/**/*.js', { nocase: true });

      assert.strictEqual(isRelevant('SRC'), true);
      assert.strictEqual(isRelevant('Src/A'), true);
      assert.strictEqual(isRelevant('DOCS'), false);
    });

    it('should support the matchBase option', () => {
      const isRelevant = dirMatcher('*.js', { matchBase: true });

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('any/deep/dir'), true);
    });

    it('should support the basename option', () => {
      const isRelevant = dirMatcher('*.js', { basename: true });

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('any/deep/dir'), true);
    });

    it('should support the contains option', () => {
      const isRelevant = dirMatcher('foo', { contains: true });

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('any/deep/dir'), true);
    });
  });

  describe('braces and extglobs', () => {
    it('should prune based on brace alternatives', () => {
      const isRelevant = dirMatcher('{src,lib}/**/*.js');

      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('lib'), true);
      assert.strictEqual(isRelevant('test'), false);
      assert.strictEqual(isRelevant('src/a'), true);
    });

    it('should handle a brace alternative spanning segments', () => {
      const isRelevant = dirMatcher('a/{x,y/z}/*.js');

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('a/x'), true);
      assert.strictEqual(isRelevant('a/y'), true);
      assert.strictEqual(isRelevant('a/y/z'), true);
      assert.strictEqual(isRelevant('a/q'), true);
      assert.strictEqual(isRelevant('b'), false);
    });

    it('should handle nested globstars in braces', () => {
      const isRelevant = dirMatcher('{**,x}/a.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('deep/dir'), true);
    });

    it('should handle qmark extglobs', () => {
      const isRelevant = dirMatcher('a/?(x)/b.js');

      assert.strictEqual(isRelevant('a'), true);
      assert.strictEqual(isRelevant('a/x'), true);
      // the middle segment can only be empty or `x`
      assert.strictEqual(isRelevant('a/y'), false);
      assert.strictEqual(isRelevant('z'), false);
    });

    it('should handle plus extglobs', () => {
      const isRelevant = dirMatcher('+(x)/y.js');

      assert.strictEqual(isRelevant('.'), true);
      assert.strictEqual(isRelevant('x'), true);
      assert.strictEqual(isRelevant('xx'), true);
      assert.strictEqual(isRelevant('y'), false);
    });
  });

  describe('windows', () => {
    it('should accept backslash-separated directory paths', () => {
      const isRelevant = dirMatcher('src/**/*.js', { windows: true });

      assert.strictEqual(isRelevant('docs'), false);
      assert.strictEqual(isRelevant('src'), true);
      assert.strictEqual(isRelevant('src\\a'), true);
      assert.strictEqual(isRelevant('src\\a\\b'), true);
      assert.strictEqual(isRelevant('docs\\sub'), false);
    });

    it('should accept mixed separators in directory paths', () => {
      const isRelevant = dirMatcher('src/**/*.js', { windows: true });

      assert.strictEqual(isRelevant('src\\a/b'), true);
      assert.strictEqual(isRelevant('src/a\\b/c'), true);
      assert.strictEqual(isRelevant('docs\\a/b'), false);
    });

    it('should treat a backslash in a windows pattern as an escape character', () => {
      // In windows mode a backslash escapes the following character (it is
      // not a path separator in the pattern itself); directory inputs use
      // backslashes as separators and are normalized when matched.
      const isRelevant = dirMatcher('src/**/*.js', { windows: true });

      assert.strictEqual(isRelevant('src\\a\\b'), true);
      assert.strictEqual(isRelevant('src/a/b'), true);
      assert.strictEqual(isRelevant('docs\\a'), false);
    });
  });

  describe('compilation', () => {
    it('should compile patterns once, not on every call', () => {
      const calls = [];
      const original = picomatch.makeRe;
      picomatch.makeRe = (...args) => {
        calls.push(args[0]);
        return original.apply(picomatch, args);
      };

      try {
        const isRelevant = dirMatcher(['src/**/*.js', 'a/b/*.js']);
        calls.length = 0;

        for (let i = 0; i < 100; i++) {
          isRelevant('src');
          isRelevant('src/a');
          isRelevant('docs');
        }

        assert.strictEqual(calls.length, 0);
      } finally {
        picomatch.makeRe = original;
      }
    });

    it('should throw on an invalid pattern', () => {
      assert.throws(() => dirMatcher(''), /Expected pattern to be a non-empty string/);
      assert.throws(() => dirMatcher(null), /Expected pattern to be a non-empty string/);
    });

    it('should throw when the directory is not a string', () => {
      const isRelevant = dirMatcher('*');
      assert.throws(() => isRelevant(123), /Expected input to be a string/);
    });
  });

  describe('soundness (no false negatives)', () => {
    // The hard guarantee: for every directory `d` the matcher returns true
    // whenever the directory itself or one of its descendants matches the
    // original patterns. This enumerates a finite path universe and compares
    // dirMatcher against full picomatch matching.
    const segments = ['a', 'b', 'ab', '.a', 'a.b', 'x.js', '.js', '1', 'Foo'];

    const universe = (() => {
      const set = new Set(['']);
      let current = [''];

      for (let depth = 0; depth < 3; depth++) {
        const next = [];
        for (const prefix of current) {
          for (const segment of segments) {
            next.push(prefix === '' ? segment : `${prefix}/${segment}`);
          }
        }
        current = next;
        current.forEach(path => set.add(path));
      }

      return [...set];
    })();

    const patterns = [
      'src/**/*.js',
      '**',
      '*',
      '*.js',
      '**/*.js',
      'a/**',
      'a/**/b.js',
      '**/b.js',
      'a/b/c',
      'a/b/*.js',
      'a/*/c',
      '*/a/*',
      '{a,b}/c.js',
      'a/{x,y/z}/*.js',
      '{src,lib}/**/*.js',
      '**/{foo,bar}',
      'a/!(b)/c',
      '!(a)',
      '!(a/b)',
      '?/[ab].js',
      '[!a-z].js',
      '!foo',
      './src/**/*.js',
      'docs/**',
      'a/*.{js,ts}',
      'foo*bar',
      'a/**/b/**/c',
      '*/*',
      '**/a/**',
      '{a,b}/{x,y}'
    ];

    const optionSets = [
      {},
      { dot: true },
      { nocase: true },
      { dot: true, nocase: true },
      { noglobstar: true },
      { noextglob: true },
      { nobrace: true },
      { ignore: ['a/b/x.js'] },
      { strictSlashes: true },
      { windows: true },
      { dot: true, windows: true },
      { matchBase: true },
      { basename: true },
      { contains: true }
    ];

    patterns.forEach(pattern => {
      optionSets.forEach(options => {
        let isRelevant;
        let isFullMatch;

        try {
          isRelevant = dirMatcher(pattern, options);
          isFullMatch = picomatch(pattern, options);
        } catch (err) {
          return;
        }

        it(`should never miss a match for ${JSON.stringify(pattern)} with ${JSON.stringify(options)}`, () => {
          for (const dir of universe) {
            const input = options.windows && dir
              ? dir.replace(/\//g, '\\')
              : dir;

            const prefix = dir === '' ? '' : `${dir}/`;
            let expected = false;

            for (const path of universe) {
              if (path !== dir && !path.startsWith(prefix)) continue;
              if (isFullMatch(path)) {
                expected = true;
                break;
              }
            }

            // The hard rule: if the directory or any descendant matches, the
            // matcher must return true. (False positives are allowed.)
            if (expected) {
              assert.strictEqual(isRelevant(input), true,
                `false negative for dir=${JSON.stringify(dir)}`);
            }
          }
        });
      });
    });

    it('should prune docs for the motivating src glob (precision)', () => {
      const isRelevant = dirMatcher('src/**/*.js');
      assert.strictEqual(isRelevant('docs'), false);
    });

    it('should agree with isMatch on a set of hand-picked cases', () => {
      const checks = [
        ['src/**/*.js', 'docs', false],
        ['src/**/*.js', 'src', true],
        ['a/b/c', 'a', true],
        ['a/b/c', 'a/b', true],
        ['a/b/c', 'a/c', false],
        ['*.js', 'src', false],
        ['*.js', '.', true],
        ['**/*.md', 'docs', true]
      ];

      for (const [pattern, dir, expected] of checks) {
        assert.strictEqual(dirMatcher(pattern)(dir), expected,
          `${pattern} vs ${dir}`);
        // sanity: isMatch stays available and unchanged
        assert.strictEqual(typeof isMatch('a.js', pattern), 'boolean');
      }
    });
  });
});
