/**
 * Wrappers around CanvasRenderingContext2D to facilitate testing and click-tracking.
 *
 * This adds the concept of a "data stack" to the canvas. When shapes are
 * drawn, they represent the objects currently on the stack. This stack can be
 * manipulated using context.pushObject() and context.popObject().
 *
 * See test file for sample usage.
 */

(function() {

'use strict';

// Turn obj into a proxy for target. This forwards both function calls and
// property setters/getters.
function forward(obj, target, onlyAccessors) {
  onlyAccessors = onlyAccessors || false;
  for (var k in target) {
    (function(k) {
      if (typeof(target[k]) == 'function') {
        if (!onlyAccessors) {
          obj[k] =  target[k].bind(target);
        }
      } else {
        Object.defineProperty(obj, k, {
          get: function() { return target[k]; },
          set: function(x) { target[k] = x; }
        });
      }
    })(k);
  }
}

// The most basic data-aware canvas. This throws away all data information.
// Use this for basic drawing
function DataContext(ctx) {
  forward(this, ctx);
  this.pushObject = this.popObject = this.reset = function() {};
}

var stubGetDataContext = null;

/**
 * Get a DataContext for the built-in CanvasRenderingContext2D.
 *
 * This caches DataContexts and facilitates stubbing in tests.
 *
 * As a convenience, you may pass in a Canvas element instead of a
 * CanvasRenderingContext2D. data-canvas will call getContext('2d') for you.
 */
function getDataContext(ctxOrCanvas) {
  if (ctxOrCanvas instanceof HTMLCanvasElement) {
    return getDataContext(ctxOrCanvas.getContext('2d'));
  }

  var ctx = ctxOrCanvas;
  if (stubGetDataContext) {
    return stubGetDataContext(ctx);
  } else {
    for (var i = 0; i < getDataContext.cache.length; i++) {
      var pair = getDataContext.cache[i];
      if (pair[0] == ctx) return pair[1];
    }
    var dtx = new DataContext(ctx);
    getDataContext.cache.push([ctx, dtx]);
    return dtx;
  }
}
getDataContext.cache = [];  // (CanvasRenderingContext2D, DataContext) pairs


/**
 * A context which records what it does (for testing).
 *
 * This proxies all calls to the underlying canvas, so they do produce visible
 * drawing. Use `drawnObjectsWith` or `calls` to test what was drawn.
 */
function RecordingContext(ctx) {
  forward(this, ctx, true /* only foward accessors */);

  var calls = [];
  this.calls = calls;

  for (var k in ctx) {
    (function(k) {
      if (typeof(ctx[k]) != 'function') return;
      this[k] = function() {
        // TODO: record current drawing style
        var args = Array.prototype.slice.call(arguments);
        calls.push([k].concat(args));
        return ctx[k].apply(ctx, arguments);
      };
    }).bind(this)(k);
  }

  this.pushObject = function(o) {
    calls.push(['pushObject', o]);
  };
  
  this.popObject = function() {
    calls.push(['popObject']);
  };

  this.reset = function() {
    this.calls = calls = [];
  };
}

/**
 * Get a list of objects which have been pushed to the data canvas that match
 * the particular predicate.
 */
RecordingContext.prototype.drawnObjectsWith = function(predicate) {
  return this.callsOf('pushObject')
             .filter(function(x) { return predicate(x[1]) })
             .map(function(x) { return x[1]; });
};

/**
 * Find calls of a particular type, e.g. `fillText` or `pushObject`.
 *
 * Returns an array of the calls and their parameters, e.g.
 * [ ['fillText', 'Hello!', 20, 10] ]
 */
RecordingContext.prototype.callsOf = function(type) {
  return this.calls.filter(function(call) { return call[0] == type });
};

/**
 * Static method to begin swapping in RecordingContext in place of DataContext.
 * Don't forget to call RecordingContext.reset() after the test completes!
 */
RecordingContext.recordAll = function() {
  if (stubGetDataContext != null) {
    throw 'You forgot to call RecordingContext.reset()';
  }
  RecordingContext.recorders = [];
  stubGetDataContext = function(ctx) {
    var recorder = RecordingContext.recorderForCanvas(ctx.canvas);
    if (recorder) return recorder;

    recorder = new RecordingContext(ctx);
    RecordingContext.recorders.push([ctx.canvas, recorder]);
    return recorder;
  };
};

/**
 * Revert the stubbing performed by RecordingContext.recordAll.
 */
RecordingContext.reset = function() {
  if (!stubGetDataContext) {
    throw 'Called RecordingContext.reset() before RecordingContext.recordAll()';
  }
  stubGetDataContext = null;
  RecordingContext.recorders = null;
};

// Get the recording context for a canvas.
RecordingContext.recorderForCanvas = function(canvas) {
  var recorders = RecordingContext.recorders;
  if (recorders == null) {
    throw 'You can only call recorderForCanvas after RecordingContext.recordAll()';
  }
  for (var i = 0; i < recorders.length; i++) {
    var r = recorders[i];
    if (r[0] == canvas) return r[1];
  }
  return null;
};

/**
 * Get the recording context for a canvas inside of div.querySelector(selector).
 *
 * This is useful when you have a test div and several canvases.
 */
RecordingContext.recorderForSelector = function(div, selector) {
  if (RecordingContext.recorders == null) {
    throw 'You can only call recorderForSelector after RecordingContext.recordAll()';
  }
  var canvas = div.querySelector(selector + ' canvas');
  if (!canvas) return null;
  return RecordingContext.recorderForCanvas(canvas);
};

// Resolves arguments for RecordingContext helpers.
// You can either specify a div & selector to find the canvas, or omit this if
// there's only one canvas being recorded.
function findRecorder(div, selector) {
  if (!div) {
    if (RecordingContext.recorders == 0) {
      throw 'Called a RecordingContext method, but no canvases are being recorded.';
    } else if (RecordingContext.recorders > 1) {
      throw 'Called a RecordingContext method while multiple canvases were being recorded. Specify one using a div and selector.';
    } else {
      return RecordingContext.recorders[0][1];
    }
  } else {
    return RecordingContext.recorderForSelector(div, selector);
  }
}

// Find objects pushed onto a particular recorded canvas.
RecordingContext.drawnObjectsWith = function(div, selector, predicate) {
  // Check for the one-argument version.
  if (typeof(div) == 'function') {
    predicate = div;
    div = null;
  }
  var recorder = findRecorder(div, selector);
  predicate = predicate || function() { return true; };
  return recorder ? recorder.drawnObjectsWith(predicate) : [];
};

// This version reads better if there's no predicate.
RecordingContext.drawnObjects = RecordingContext.drawnObjectsWith;

// Find calls of particular drawing functions (e.g. fillText)
RecordingContext.callsOf = function (div, selector, type) {
  // Check for the one-argument version.
  if (typeof(div) == 'string') {
    type = div;
    div = null;
  }
  var recorder = findRecorder(div, selector);
  return recorder ? recorder.callsOf(type) : [];
};


/**
 * A context which determines the data at a particular location.
 *
 * When drawing methods are called on this class, nothing is rendered. Instead,
 * each shape is checked to see if it includes the point of interest. If it
 * does, the current data stack is saved as a "hit".
 *
 * The `hits` property records all such hits.
 * The `hit` property records only the last (top) hit.
 */
function ClickTrackingContext(ctx, px, py) {
  forward(this, ctx);

  var stack = [];
  this.hits = [];
  this.hit = null;
  
  var that = this;
  function recordHit() {
    that.hits.unshift(Array.prototype.slice.call(stack));
    that.hit = that.hits[0];
  }

  this.pushObject = function(o) {
    stack.unshift(o);
  };
  
  this.popObject = function() {
    stack.shift();
  };

  this.reset = function() {
    this.hits = [];
    this.hit = null;
  };

  // These are (most of) the canvas methods which draw something.
  this.clearRect = function(x, y, w, h) { };

  this.fillRect = function(x, y, w, h) {
    if (px >= x && px <= x + w && py >= y && py <= y + h) recordHit();
  };

  this.strokeRect = function(x, y, w, h) {
    // ...
  };

  this.fill = function(fillRule) {
    // TODO: implement fillRule
    if (ctx.isPointInPath(px, py)) recordHit();
  };

  this.stroke = function() {
    if (ctx.isPointInStroke(px, py)) recordHit();
  };

  this.fillText = function(text, x, y, maxWidth) {
    // ...
  };

  this.strokeText = function(text, x, y, maxWidth) {
    // ...
  };
}

var exports = {
  DataContext: DataContext,
  RecordingContext: RecordingContext,
  ClickTrackingContext: ClickTrackingContext,
  getDataContext: getDataContext
};

if (typeof(module) !== 'undefined') {
  module.exports = exports;
} else {
  window.dataCanvas = exports;
}

})();
