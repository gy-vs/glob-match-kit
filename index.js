'use strict';

const pico = require('./lib/picomatch');
const utils = require('./lib/utils');

function picomatch(glob, options, returnState = false) {
  // default to os.platform()
  if (options && (options.windows === null || options.windows === undefined)) {
    // don't mutate the original options object
    options = { ...options, windows: utils.isWindows() };
  }

  return pico(glob, options, returnState);
}

function dirMatcher(glob, options) {
  // default to os.platform()
  if (options && (options.windows === null || options.windows === undefined)) {
    // don't mutate the original options object
    options = { ...options, windows: utils.isWindows() };
  }

  return pico.dirMatcher(glob, options);
}

Object.assign(picomatch, pico);
picomatch.dirMatcher = dirMatcher;
module.exports = picomatch;
