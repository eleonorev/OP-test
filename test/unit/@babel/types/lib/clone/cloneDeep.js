"use strict";

exports.__esModule = true;
exports.default = cloneDeep;

var _cloneNode = _interopRequireDefault(require("./cloneNode"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function cloneDeep(node) {
  return (0, _cloneNode.default)(node);
}