'use strict';

var Node = require('snapdragon-node');
var utils = require('./utils');

/**
 * Braces parsers
 */

module.exports = function(braces, options) {
  function update(parent, val) {
    if (parent && parent.type === 'brace') {
      parent.text = parent.text || '';
      parent.text += val;
    }
  }

  braces.parser
    .set('bos', function() {
      if (!this.parsed) {
        this.ast = this.nodes[0] = new Node(this.ast);
      }
    })

    /**
     * Character parsers
     */

    .set('escape', function() {
      var pos = this.position();
      var m = this.match(/^(?:\\(.)|\$\{)/);
      if (!m) return;

      var prev = this.prev();
      var last = utils.last(prev.nodes);

      var node = pos(new Node({
        type: 'text',
        multiplier: 1,
        val: m[0]
      }));

      if (node.val === '\\\\') {
        return node;
      }

      if (node.val === '${') {
        var str = this.input;
        var idx = -1;
        var ch;

        while ((ch = str[++idx])) {
          this.consume(1);
          node.val += ch;
          if (ch === '\\') {
            node.val += str[++idx];
            continue;
          }
          if (ch === '}') {
            break;
          }
        }
      }

      if (this.options.unescape !== false) {
        node.val = node.val.replace(/\\([{}])/g, '$1');
      }

      if (last.val === '"' && this.input.charAt(0) === '"') {
        last.val = node.val;
        this.consume(1);
        return;
      }

      return concatNodes.call(this, pos, node, prev, options);
    })

    /**
     * Brackets: "[...]" (basic, this is overridden by
     * other parsers in more advanced implementations)
     */

    .set('bracket', function() {
      var pos = this.position();
      var m = this.match(/^(?:\[([!^]?)([^\]]{2,}|\]\-)(\]|[^*+?]+)|\[)/);
      if (!m) return;

      var prev = this.prev();
      var val = m[0];
      var negated = m[1] ? '^' : '';
      var inner = m[2] || '';
      var close = m[3] || '';

      var esc = this.input.slice(0, 2);
      if (inner === '' && esc === '\\]') {
        inner += esc;
        this.consume(2);

        var str = this.input;
        var idx = -1;
        var ch;

        while ((ch = str[++idx])) {
          this.consume(1);
          if (ch === ']') {
            close = ch;
            break;
          }
          inner += ch;
        }
      }

      var node = pos(new Node({
        type: 'bracket',
        val: val,
        escaped: close !== ']',
        negated: negated,
        inner: inner,
        close: close
      }));

      update(prev, m[0]);
      return node;
    })

    /**
     * Empty braces (we capture these early to
     * speed up processing in the compiler)
     */

    .set('multiplier', function() {
      var pos = this.position();
      var m = this.match(/^\{(,+(?:(\{,+\})*),*|,*(?:(\{,+\})*),+)\}/);
      if (!m) return;

      this.multiplier = true;
      var prev = this.prev();
      var val = m[0];

      update(prev, val);

      var node = pos(new Node({
        type: 'text',
        multiplier: 1,
        match: m,
        val: val
      }));

      return concatNodes.call(this, pos, node, prev, options);
    })

    /**
     * Paren open: "("
     */

    .set('paren.open', function() {
      var pos = this.position();
      var m = this.match(/^\(/);
      if (!m) return;

      var prev = this.prev();
      var node = pos(new Node({
        type: 'paren',
        nodes: []
      }));

      var open = pos(new Node({
        type: 'paren.open',
        val: m[0]
      }));

      node.push(open);
      prev.push(node);
      this.push('paren', node);
    })

    /**
     * Paren close: ")"
     */

    .set('paren.close', function() {
      var pos = this.position();
      var m = this.match(/^\)/);
      if (!m) return;

      var paren = this.pop('paren');
      var node = pos(new Node({
        type: 'paren.close',
        val: m[0]
      }));

      if (!this.isType(paren, 'paren')) {
        if (this.options.strict) {
          throw new Error('missing opening "("');
        }
        node.type = 'text';
        node.escaped = true;
        return node;
      }

      var prev = this.prev();
      paren.push(node);

      // paren.type = 'text';
      // paren.val = '';

      function addNode(node) {
        // node.type = 'text';
        // var last = prev.nodes[prev.nodes.length - 1];
        // if (last && last.type === 'text') {
        //   last.val += node.val;
        // } else {
        //   prev.nodes.push(node);
        // }
        prev.nodes.push(node);
      }

      visit(paren, function(n) {
        // if (n.type === 'paren.open' || n.type === 'paren.close') {
        //   n.type = 'text';
        // }
        if (n.val && prev.type === 'brace') {
          prev.text += n.val;
        }
        // if (n.val) {
        //   addNode(n);
        // }
        // if (n.type === 'bracket') {
        //   paren.val += n.val;
        //   if (n.inner === '\\]') {
        //     paren.val += n.inner;
        //   }
        //   paren.val += n.close;
        // } else if (n.type === 'paren.open' || n.type === 'paren.close') {
        //   paren.val += n.val;
        //   paren.unescape = false;
        // } else if (n.val) {
        //   paren.val += n.val;
        // }
      });

      var arr = prev.nodes.slice();
      var close = arr[arr.length - 1];
      var nodes = [arr[0]];

      delete paren.nodes;
      var split = require('split-string');
      var segs = split(prev.text, {separator: ','});
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i];
        if (i !== segs.length && i !== segs.length - 1) seg += ',';
        var n = new Node({type: 'text', val: seg});
        n.optimize = false;
        n.parent = prev;
        nodes.push(n);
      }

      prev.nodes = nodes;
    })

    /**
     * Brace open: "{"
     */

    .set('brace.open', function() {
      var pos = this.position();
      var m = this.match(/^\{(?!(?:[^\\}]?|,+)\})/);
      if (!m) return;

      var prev = this.prev();
      var last = utils.last(prev.nodes);

      var open = pos(new Node({
        type: 'brace.open',
        val: m[0]
      }));

      var brace = pos(new Node({
        type: 'brace',
        nodes: []
      }));

      // if the last parsed character was an extglob character
      // we need to _not optimize or escape_ the brace pattern because
      // it might be mistaken for an extglob by a downstream parser
      if (last && last.val && isExtglobChar(last.val.slice(-1))) {
        last.val = last.val.replace(/([@!*+?])/, '\\$1');
        brace.hasExtglob = true;
        // last.optimize = false;
      }

      brace.push(open);
      prev.push(brace);
      this.push('brace', brace);
    })

    /**
     * Brace close: "}"
     */

    .set('brace.close', function() {
      var pos = this.position();
      var m = this.match(/^\}/);
      if (!m || !m[0]) return;

      var brace = this.pop('brace');
      update(his.prev(), m[0]);

      var node = pos(new Node({
        type: 'brace.close',
        val: m[0]
      }));

      if (!this.isType(brace, 'brace')) {
        if (this.options.strict) {
          throw new Error('missing opening "{"');
        }
        node.type = 'text';
        node.multiplier = 0;
        node.escaped = true;
        return node;
      }

      // var last = utils.last(prev.nodes);
      // if (last.text) {
      //   var lastNode = utils.last(last.nodes);
      //   if (lastNode.val === ')' && /[!@*?+]\(/.test(last.text)) {
      //     var open = last.nodes[0];
      //     var text = last.nodes[1];
      //     if (open.type === 'brace.open' && text && text.type === 'text') {
      //       text.optimize = false;
      //     }
      //   }
      // }

      // if (brace.nodes.length > 2) {
      //   var first = brace.nodes[1];
      //   if (first.type === 'text' && first.val === ',') {
      //     brace.nodes.splice(1, 1);
      //     brace.nodes.push(first);
      //   }
      // }

      brace.push(node);

      if (utils.hasExtglob(brace.text)) {
        brace.optimize = false;
        prev.optimize = false;
      //   brace.nodes.forEach(function(node) {
      //     node.optimize = false;
      //   });
        visit(prev, function(node) {
          node.optimize = false;
          return node;
        });
      }
      delete brace.text;
      console.log(brace)
    })

    /**
     * Capture boundary characters
     */

    .set('boundary', function() {
      var pos = this.position();
      var m = this.match(/^[$^](?!\{)/);
      if (!m) return;

      update(this.prev(), m[0]);

      return pos(new Node({
        type: 'text',
        val: m[0]
      }));
    })

    /**
     * One or zero, non-comma characters wrapped in braces
     */

    .set('nobrace', function() {
      var pos = this.position();
      var m = this.match(/^\{[^,]?\}/);
      if (!m) return;

      var prev = this.prev();
      var val = m[0];

      update(prev, val);

      return pos(new Node({
        type: 'text',
        multiplier: 0,
        val: val
      }));
    })

    /**
     * Text
     */

    .set('text', function() {
      var pos = this.position();
      var m = this.match(/^((?!\\)[^${}()\[\]])+/);
      if (!m) return;

      var prev = this.prev();
      var val = m[0];

      update(prev, val);

      var node = pos(new Node({
        type: 'text',
        multiplier: 1,
        val: val
      }));

      concatNodes.call(this, pos, node, prev, options);
    });
};

/**
 * Returns true if the character is an extglob character.
 */

function isExtglobChar(ch) {
  return ch === '!' || ch === '@' || ch === '*' || ch === '?' || ch === '+';
}

/**
 * Combine text nodes, and calculate empty sets (`{,,}`)
 * @param {Function} `pos` Function to calculate node position
 * @param {Object} `node` AST node
 * @return {Object}
 */

function concatNodes(pos, node, parent, options) {
  node.orig = node.val;
  var prev = this.prev();
  var last = utils.last(prev.nodes);
  var isEscaped = false;

  if (node.val.length > 1) {
    var a = node.val.charAt(0);
    var b = node.val.slice(-1);

    isEscaped = (a === '"' && b === '"')
      || (a === "'" && b === "'")
      || (a === '`' && b === '`');
  }

  if (isEscaped && options.unescape !== false) {
    node.val = node.val.slice(1, node.val.length - 1);
    node.escaped = true;
  }

  if (node.match) {
    var match = node.match[1];
    if (!match || match.indexOf('}') === -1) {
      match = node.match[0];
    }

    // replace each set with a single ","
    var val = match.replace(/\{/g, ',').replace(/\}/g, '');
    node.multiplier *= val.length;
    node.val = '';
  }

  var simpleText = last.type === 'text'
    && last.multiplier === 1
    && node.multiplier === 1
    && node.val;

  if (simpleText) {
    last.val += node.val;
    return;
  }

  prev.push(node);
}

function visit(node, fn) {
  fn(node);
  return node.nodes ? mapVisit(node, fn) : node;
}

function mapVisit(node, fn) {
  for (let i = 0; i < node.nodes.length; i++) {
    visit(node.nodes[i], fn);
  }
  return node;
}
