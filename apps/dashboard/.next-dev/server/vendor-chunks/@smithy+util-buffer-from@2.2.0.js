"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@smithy+util-buffer-from@2.2.0";
exports.ids = ["vendor-chunks/@smithy+util-buffer-from@2.2.0"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+util-buffer-from@2.2.0/node_modules/@smithy/util-buffer-from/dist-es/index.js":
/*!**********************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+util-buffer-from@2.2.0/node_modules/@smithy/util-buffer-from/dist-es/index.js ***!
  \**********************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   fromArrayBuffer: () => (/* binding */ fromArrayBuffer),\n/* harmony export */   fromString: () => (/* binding */ fromString)\n/* harmony export */ });\n/* harmony import */ var _smithy_is_array_buffer__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @smithy/is-array-buffer */ \"(rsc)/../../node_modules/.pnpm/@smithy+is-array-buffer@2.2.0/node_modules/@smithy/is-array-buffer/dist-es/index.js\");\n/* harmony import */ var buffer__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! buffer */ \"buffer\");\n/* harmony import */ var buffer__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(buffer__WEBPACK_IMPORTED_MODULE_1__);\n\n\nconst fromArrayBuffer = (input, offset = 0, length = input.byteLength - offset) => {\n    if (!(0,_smithy_is_array_buffer__WEBPACK_IMPORTED_MODULE_0__.isArrayBuffer)(input)) {\n        throw new TypeError(`The \"input\" argument must be ArrayBuffer. Received type ${typeof input} (${input})`);\n    }\n    return buffer__WEBPACK_IMPORTED_MODULE_1__.Buffer.from(input, offset, length);\n};\nconst fromString = (input, encoding) => {\n    if (typeof input !== \"string\") {\n        throw new TypeError(`The \"input\" argument must be of type string. Received type ${typeof input} (${input})`);\n    }\n    return encoding ? buffer__WEBPACK_IMPORTED_MODULE_1__.Buffer.from(input, encoding) : buffer__WEBPACK_IMPORTED_MODULE_1__.Buffer.from(input);\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXRpbC1idWZmZXItZnJvbUAyLjIuMC9ub2RlX21vZHVsZXMvQHNtaXRoeS91dGlsLWJ1ZmZlci1mcm9tL2Rpc3QtZXMvaW5kZXguanMiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7QUFBd0Q7QUFDeEI7QUFDekI7QUFDUCxTQUFTLHNFQUFhO0FBQ3RCLHVGQUF1RixjQUFjLEdBQUcsTUFBTTtBQUM5RztBQUNBLFdBQVcsMENBQU07QUFDakI7QUFDTztBQUNQO0FBQ0EsMEZBQTBGLGNBQWMsR0FBRyxNQUFNO0FBQ2pIO0FBQ0Esc0JBQXNCLDBDQUFNLHlCQUF5QiwwQ0FBTTtBQUMzRCIsInNvdXJjZXMiOlsiQzpcXGRldlxcbWVkaWNhbC1hcS1xYVxcbm9kZV9tb2R1bGVzXFwucG5wbVxcQHNtaXRoeSt1dGlsLWJ1ZmZlci1mcm9tQDIuMi4wXFxub2RlX21vZHVsZXNcXEBzbWl0aHlcXHV0aWwtYnVmZmVyLWZyb21cXGRpc3QtZXNcXGluZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGlzQXJyYXlCdWZmZXIgfSBmcm9tIFwiQHNtaXRoeS9pcy1hcnJheS1idWZmZXJcIjtcbmltcG9ydCB7IEJ1ZmZlciB9IGZyb20gXCJidWZmZXJcIjtcbmV4cG9ydCBjb25zdCBmcm9tQXJyYXlCdWZmZXIgPSAoaW5wdXQsIG9mZnNldCA9IDAsIGxlbmd0aCA9IGlucHV0LmJ5dGVMZW5ndGggLSBvZmZzZXQpID0+IHtcbiAgICBpZiAoIWlzQXJyYXlCdWZmZXIoaW5wdXQpKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYFRoZSBcImlucHV0XCIgYXJndW1lbnQgbXVzdCBiZSBBcnJheUJ1ZmZlci4gUmVjZWl2ZWQgdHlwZSAke3R5cGVvZiBpbnB1dH0gKCR7aW5wdXR9KWApO1xuICAgIH1cbiAgICByZXR1cm4gQnVmZmVyLmZyb20oaW5wdXQsIG9mZnNldCwgbGVuZ3RoKTtcbn07XG5leHBvcnQgY29uc3QgZnJvbVN0cmluZyA9IChpbnB1dCwgZW5jb2RpbmcpID0+IHtcbiAgICBpZiAodHlwZW9mIGlucHV0ICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYFRoZSBcImlucHV0XCIgYXJndW1lbnQgbXVzdCBiZSBvZiB0eXBlIHN0cmluZy4gUmVjZWl2ZWQgdHlwZSAke3R5cGVvZiBpbnB1dH0gKCR7aW5wdXR9KWApO1xuICAgIH1cbiAgICByZXR1cm4gZW5jb2RpbmcgPyBCdWZmZXIuZnJvbShpbnB1dCwgZW5jb2RpbmcpIDogQnVmZmVyLmZyb20oaW5wdXQpO1xufTtcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+util-buffer-from@2.2.0/node_modules/@smithy/util-buffer-from/dist-es/index.js\n");

/***/ })

};
;