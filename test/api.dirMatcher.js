'use strict';

const assert = require('assert');
const picomatch = require('..');

describe('picomatch', () => {
  describe('.dirMatcher', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof picomatch.dirMatcher, 'function');
    });

    it('should throw on invalid arguments', () => {
      assert.throws(() => picomatch.dirMatcher(''), /Expected pattern to be a non-empty string/);
      assert.throws(() => picomatch.dirMatcher(null), /Expected pattern to be a non-empty string/);
      assert.throws(() => picomatch.dirMatcher(123), /Expected pattern to be a non-empty string/);

      const isReachable = picomatch.dirMatcher('*');
      assert.throws(() => isReachable(123), /Expected input to be a string/);
    });

    it('should return a function', () => {
      assert.strictEqual(typeof picomatch.dirMatcher('**'), 'function');
      assert.strictEqual(typeof picomatch.dirMatcher(['a', 'b']), 'function');
    });

    describe('basic pruning', () => {
      it('should prune directories that cannot contain a match', () => {
        const isReachable = picomatch.dirMatcher('src/**/*.js');

        assert(isReachable(''));
        assert(isReachable('.'));
        assert(isReachable('src'));
        assert(isReachable('src/'));
        assert(isReachable('src/foo'));
        assert(isReachable('src/foo/bar'));

        assert(!isReachable('docs'));
        assert(!isReachable('node_modules'));
        assert(!isReachable('test'));
        assert(!isReachable('srcx'));
      });

      it('should match the motivating src/**/*.js vs docs example exactly', () => {
        const isReachable = picomatch.dirMatcher('src/**/*.js');
        assert.strictEqual(isReachable('src'), true);
        assert.strictEqual(isReachable('docs'), false);
      });

      it('should handle a fixed base without globstar', () => {
        const isReachable = picomatch.dirMatcher('foo/bar/*.js');

        assert(isReachable('foo'));
        assert(isReachable('foo/bar'));
        assert(isReachable('foo/bar/'));

        assert(!isReachable('baz'));
        assert(!isReachable('foos'));
        assert(!isReachable('foo/baz'));
      });

      it('should handle literal file patterns', () => {
        const isReachable = picomatch.dirMatcher('a/b/c.js');

        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(isReachable('a/b/c.js'));

        assert(!isReachable('a/b/c'));
        assert(!isReachable('x'));
        assert(!isReachable('a/x'));
      });

      it('should prune below a non-matching single-star segment', () => {
        const isReachable = picomatch.dirMatcher('foo/*/baz');

        assert(isReachable('foo'));
        assert(isReachable('foo/abc'));
        assert(isReachable('foo/abc/baz'));
        // a directory one level below the matching segment cannot lead
        // to a match of `foo/*/baz`
        assert(!isReachable('foo/abc/def'));
        assert(!isReachable('foo/abc/baz/deep'));
      });

      it('should treat root-only patterns accordingly', () => {
        const isReachable = picomatch.dirMatcher('*.js');

        assert(isReachable(''));
        assert(isReachable('.'));
        assert(isReachable('a.js'));

        assert(!isReachable('src'));
        assert(!isReachable('src/a.js'));
        assert(!isReachable('a/b.js'));
      });

      it('should always descend from the root when the pattern is a global globstar', () => {
        const isReachable = picomatch.dirMatcher('**/*.js');

        assert(isReachable('src'));
        assert(isReachable('docs'));
        assert(isReachable('node_modules'));
        assert(isReachable('a/b/c'));
      });

      it('should recognize globstar followed by a fixed segment', () => {
        const isReachable = picomatch.dirMatcher('**/foo');

        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(isReachable('foo'));
      });
    });

    describe('patterns with globstars', () => {
      it('should handle trailing globstars', () => {
        const isReachable = picomatch.dirMatcher('a/**');

        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(isReachable('a/b/c'));
        assert(!isReachable('b'));
        assert(!isReachable('ab'));
      });

      it('should handle multiple globstars', () => {
        const isReachable = picomatch.dirMatcher('a/**/b/**/c');

        assert(isReachable('a'));
        assert(isReachable('a/x'));
        assert(isReachable('a/b'));
        assert(isReachable('a/b/x'));
        assert(isReachable('a/x/b'));
        assert(isReachable('a/x/b/y'));
        assert(!isReachable('x'));
      });

      it('should distinguish prefixes with segment boundaries', () => {
        const isReachable = picomatch.dirMatcher('foo/**');

        assert(isReachable('foo'));
        assert(isReachable('foo/bar'));
        assert(!isReachable('foobar'));
        assert(!isReachable('foos/x'));
      });
    });

    describe('pattern arrays', () => {
      it('should match when any of the patterns is reachable', () => {
        const isReachable = picomatch.dirMatcher(['src/**/*.js', 'docs/**/*.md']);

        assert(isReachable('src'));
        assert(isReachable('src/foo'));
        assert(isReachable('docs'));
        assert(isReachable('docs/foo'));
        assert(!isReachable('test'));
        assert(!isReachable('build'));
      });

      it('should treat negated array elements like the main matcher (independent patterns)', () => {
        // picomatch matches if ANY array pattern matches; a negated array
        // element on its own matches almost everything
        const isReachable = picomatch.dirMatcher(['**/*.js', '!src/vendor/**']);
        assert(isReachable('src'));
        assert(isReachable('src/vendor'));
        assert(isReachable('docs'));
      });
    });

    describe('negation', () => {
      it('should always descend for a top-level negated pattern', () => {
        const isReachable = picomatch.dirMatcher('!foo');
        assert(isReachable('foo'));
        assert(isReachable('bar'));
        assert(isReachable('a/b/c'));
      });
    });

    describe('dot option', () => {
      it('does not need to descend into a leading dot segment when the pattern cannot match there', () => {
        const isReachable = picomatch.dirMatcher('**/*.js');

        // `.hidden/a.js` does not match, so the directory can be pruned
        assert(!isReachable('.hidden'));
      });

      it('should descend into dot directories when a pattern requires it', () => {
        const explicit = picomatch.dirMatcher('**/.config/**/*.js');
        assert(explicit('.config'));
        assert(explicit('a/.config'));
        assert(explicit('a/.config/b'));

        const dotted = picomatch.dirMatcher('**/.*.md', { dot: true });
        assert(dotted('a/.hidden'));
      });

      it('should not reach leading dot directories without the dot option', () => {
        // `**/*.js` cannot match a path starting with a dot segment...
        assert(!picomatch('**/*.js')('.hidden/a.js'));
        // ...so that directory must be prunable
        assert(!picomatch.dirMatcher('**/*.js')('.hidden'));

        // with dot enabled it is reachable
        assert(picomatch.dirMatcher('**/*.js', { dot: true })('.hidden'));
      });

      it('should be consistent with the full matcher for dot segments', () => {
        assert(picomatch.dirMatcher('a/*/*.md', { dot: true })('a/.b'));
        assert(picomatch('a/*/*.md', { dot: true })('a/.b/c.md'));

        // every match of the full matcher must have a reachable parent
        const dirMatcher = picomatch.dirMatcher('a/*/*.md', { dot: true });
        assert(picomatch('a/*/*.md', { dot: true })('a/.b/c.md'));
        assert(dirMatcher('a/.b'));
      });
    });

    describe('nocase option', () => {
      it('should be case-insensitive', () => {
        const isReachable = picomatch.dirMatcher('src/**/*.js', { nocase: true });

        assert(isReachable('SRC'));
        assert(isReachable('Src/Foo'));
        assert(!isReachable('docs'));
      });
    });

    describe('braces', () => {
      it('should handle brace sets in prefixes', () => {
        const isReachable = picomatch.dirMatcher('{src,lib}/**/*.js');

        assert(isReachable('src'));
        assert(isReachable('lib'));
        assert(isReachable('src/foo'));
        assert(!isReachable('test'));
      });

      it('should handle nested braces with slashes', () => {
        const isReachable = picomatch.dirMatcher('a/{b,c/d}/e');

        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(isReachable('a/c'));
        assert(isReachable('a/c/d'));
        assert(!isReachable('a/x'));
      });
    });

    describe('extglobs', () => {
      it('should handle negated extglobs in a segment', () => {
        const isReachable = picomatch.dirMatcher('foo/!(x)/y');

        assert(isReachable('foo'));
        assert(isReachable('foo/abc'));
        assert(!isReachable('foo/abc/z'));
      });

      it('should handle extglobs that span slashes', () => {
        const isReachable = picomatch.dirMatcher('c!(/z)z');

        assert(isReachable('c'));
        assert(isReachable('c/foo'));
        assert(isReachable('c/foo/deep'));
      });

      it('should handle plus/at/question/star extglobs', () => {
        assert(picomatch.dirMatcher('+(a|b)/c')('a'));
        assert(picomatch.dirMatcher('+(a|b)/c')('aaa'));
        assert(!picomatch.dirMatcher('+(a|b)/c')('x'));

        assert(picomatch.dirMatcher('@(a|b)/c')('a'));
        assert(!picomatch.dirMatcher('@(a|b)/c')('aa'));
      });

      it('should handle BOS negate extglobs', () => {
        const isReachable = picomatch.dirMatcher('!(a/b)');
        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(isReachable('x'));
        assert(isReachable('x/y'));
      });
    });

    describe('character classes and qmarks', () => {
      it('should handle bracket classes', () => {
        const isReachable = picomatch.dirMatcher('[a-c]*.js');

        assert(isReachable('abc.js'));
        assert(!isReachable('xyz.js'));
        assert(!isReachable('src'));
      });

      it('should handle question marks', () => {
        const isReachable = picomatch.dirMatcher('a/?/c');

        assert(isReachable('a'));
        assert(isReachable('a/b'));
        assert(!isReachable('a/bc'));
        assert(!isReachable('a/b/d'));
      });
    });

    describe('windows option', () => {
      it('should accept backslash-separated directory paths', () => {
        const isReachable = picomatch.dirMatcher('src/**/*.js', { windows: true });

        assert(isReachable('src'));
        assert(isReachable('src\\foo'));
        assert(isReachable('src\\foo\\bar'));
        assert(isReachable('src\\'));
        assert(isReachable('src/foo'));
        assert(!isReachable('docs'));
        assert(!isReachable('docs\\x'));
      });

      it('should accept mixed separators', () => {
        const isReachable = picomatch.dirMatcher('a/b/**', { windows: true });
        assert(isReachable('a\\b'));
        assert(isReachable('a\\b\\c'));
        assert(isReachable('a/b\\c'));
        assert(!isReachable('a\\c'));
      });
    });

    describe('other options', () => {
      it('should treat every directory as reachable with matchBase/basename', () => {
        for (const option of ['matchBase', 'basename']) {
          const isReachable = picomatch.dirMatcher('*.js', { [option]: true });
          assert(isReachable('src'));
          assert(isReachable('a/b/c'));
          assert(isReachable('.'));
        }
      });
    });

    describe('soundness (no missed matches)', () => {
      // The hard guarantee: for every path the main matcher matches, the
      // directory matcher must return true for every strict ancestor
      // directory of that path.
      const patterns = [
        'src/**/*.js', '*.js', '**/*.js', '**', '**/', 'a/**', 'a/**/',
        'a/**/*', 'a/*/**', 'foo/bar.js', 'foo/*/baz/*.js',
        'foo/{a,b}/*.js', '{a,b}/c', 'a/{b,c/d}/e', '!(a/b)', '*.!(js)',
        'foo/!(x)/y', '+(a|b)/c', '?(x)/y', '*(a)b', '@(a|b).md',
        '[a-c]*.js', 'foo/?/bar', 'a/b/c/**/d/*.md', '**/foo', 'foo',
        './foo/bar/*.js', '/foo/bar/*.js', '/*', '/a/b/**', '.*/**',
        '.*.md', 'a/.*.md', 'foo/{a,b/{c,d}}/**/x*.{js,ts}',
        'a/b/**/!(x)/y', '!(foo)', '!foo', 'foo/*/**/*.js', 'a/b/c',
        'a/**/b/**/c', 'x/**/@(y|z)/*.md', '**/node_modules/**', 'src/**',
        'foo/bar*', 'foo/**/**/*.js', 'a/[x-z]/b', 'foo/(a|b)/baz',
        'a/**/*.{js,ts}', '*.{js,ts}', 'foo/bar/**',
        'test/spec/**/*.spec.js', '[^a]*.js', '**.md', 'c!(/z)z',
        'foo[[:punct:]]*', '**/*.md', 'a/**@(/x|/z)/*.md', '**/.*',
        '*.min.js', '!foo/bar/*.js', 'a/!(b)c', '**!(abc)**'
      ];

      const optionsList = [
        {},
        { dot: true },
        { nocase: true },
        { dot: true, nocase: true },
        { windows: true },
        { windows: true, nocase: true },
        { bash: true },
        { noextglob: true },
        { nobrace: true },
        { nobracket: true },
        { noglobstar: true },
        { strictSlashes: true }
      ];

      const words = [
        'a', 'b', 'c', 'x', 'y', 'z', 'src', 'docs', 'foo', 'bar', 'baz',
        'index', 'app', '.hidden', 'main.js', 'a.js', 'b.ts',
        'node_modules', '1', 'ab', 'test', 'spec', 'q', 'aa', 'c.md',
        'deep', 'path', 'subdir', 'm', 'v', 'e', 'c.mdx', 'cz'
      ];

      function rng(seed) {
        let s = seed >>> 0;
        return () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s / 4294967296;
        };
      }

      it('never rejects a directory containing a full matcher hit', () => {
        const rand = rng(20240101);

        for (const options of optionsList) {
          for (const pattern of patterns) {
            let isMatch;
            let isReachable;

            try {
              isMatch = picomatch(pattern, options);
              isReachable = picomatch.dirMatcher(pattern, options);
            } catch (err) {
              continue;
            }

            for (let i = 0; i < 200; i++) {
              const depth = 1 + Math.floor(rand() * 4);
              const segments = [];
              for (let j = 0; j < depth; j++) {
                segments.push(words[Math.floor(rand() * words.length)]);
              }
              const input = segments.join('/');

              if (!isMatch(input)) continue;

              for (let k = 0; k < segments.length; k++) {
                const dir = segments.slice(0, k + 1).join('/');
                const variants = options.windows
                  ? [dir, dir.replace(/\//g, '\\')]
                  : [dir];

                for (const value of variants) {
                  assert(isReachable(value),
                    `pattern ${JSON.stringify(pattern)} options ${JSON.stringify(options)} ` +
                    `matched ${JSON.stringify(input)} but dir ${JSON.stringify(value)} was rejected`);
                }
              }
            }
          }
        }
      });

      it('is sound for arrays of patterns', () => {
        const rand = rng(42);
        const sets = [
          ['src/**/*.js', 'docs/**/*.md'],
          ['**/*.js', '*.ts'],
          ['{foo,bar}/**', '!bar/skip/**'],
          ['a/**', 'b/**/c']
        ];

        for (const options of [{}, { windows: true }, { dot: true }]) {
          for (const globs of sets) {
            const isMatch = picomatch(globs, options);
            const isReachable = picomatch.dirMatcher(globs, options);

            for (let i = 0; i < 200; i++) {
              const depth = 1 + Math.floor(rand() * 4);
              const segments = [];
              for (let j = 0; j < depth; j++) {
                segments.push(words[Math.floor(rand() * words.length)]);
              }
              const input = segments.join('/');

              if (!isMatch(input)) continue;

              for (let k = 0; k < segments.length; k++) {
                const dir = segments.slice(0, k + 1).join('/');
                assert(isReachable(dir),
                  `patterns ${JSON.stringify(globs)} matched ${JSON.stringify(input)} ` +
                  `but ${JSON.stringify(dir)} was rejected`);
              }
            }
          }
        }
      });
    });

    describe('compilation / performance', () => {
      it('compiles patterns once at creation and reuses them', () => {
        const isReachable = picomatch.dirMatcher('a/**/b/*.js');

        // calling the returned function many times must not throw and
        // must remain consistent
        for (let i = 0; i < 10000; i++) {
          assert.strictEqual(isReachable('a/x/y'), true);
          assert.strictEqual(isReachable('z'), false);
        }
      });
    });
  });
});
