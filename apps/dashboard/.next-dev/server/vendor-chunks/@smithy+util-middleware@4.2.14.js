"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@smithy+util-middleware@4.2.14";
exports.ids = ["vendor-chunks/@smithy+util-middleware@4.2.14"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/getSmithyContext.js":
/*!********************************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/getSmithyContext.js ***!
  \********************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   getSmithyContext: () => (/* binding */ getSmithyContext)\n/* harmony export */ });\n/* harmony import */ var _smithy_types__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @smithy/types */ \"(rsc)/../../node_modules/.pnpm/@smithy+types@4.14.1/node_modules/@smithy/types/dist-es/middleware.js\");\n\nconst getSmithyContext = (context) => context[_smithy_types__WEBPACK_IMPORTED_MODULE_0__.SMITHY_CONTEXT_KEY] || (context[_smithy_types__WEBPACK_IMPORTED_MODULE_0__.SMITHY_CONTEXT_KEY] = {});\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXRpbC1taWRkbGV3YXJlQDQuMi4xNC9ub2RlX21vZHVsZXMvQHNtaXRoeS91dGlsLW1pZGRsZXdhcmUvZGlzdC1lcy9nZXRTbWl0aHlDb250ZXh0LmpzIiwibWFwcGluZ3MiOiI7Ozs7O0FBQW1EO0FBQzVDLDhDQUE4Qyw2REFBa0IsY0FBYyw2REFBa0IsTUFBTSIsInNvdXJjZXMiOlsiQzpcXGRldlxcbWVkaWNhbC1hcS1xYVxcbm9kZV9tb2R1bGVzXFwucG5wbVxcQHNtaXRoeSt1dGlsLW1pZGRsZXdhcmVANC4yLjE0XFxub2RlX21vZHVsZXNcXEBzbWl0aHlcXHV0aWwtbWlkZGxld2FyZVxcZGlzdC1lc1xcZ2V0U21pdGh5Q29udGV4dC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTTUlUSFlfQ09OVEVYVF9LRVkgfSBmcm9tIFwiQHNtaXRoeS90eXBlc1wiO1xuZXhwb3J0IGNvbnN0IGdldFNtaXRoeUNvbnRleHQgPSAoY29udGV4dCkgPT4gY29udGV4dFtTTUlUSFlfQ09OVEVYVF9LRVldIHx8IChjb250ZXh0W1NNSVRIWV9DT05URVhUX0tFWV0gPSB7fSk7XG4iXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbMF0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/getSmithyContext.js\n");

/***/ }),

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/normalizeProvider.js":
/*!*********************************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/normalizeProvider.js ***!
  \*********************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   normalizeProvider: () => (/* binding */ normalizeProvider)\n/* harmony export */ });\nconst normalizeProvider = (input) => {\n    if (typeof input === \"function\")\n        return input;\n    const promisified = Promise.resolve(input);\n    return () => promisified;\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXRpbC1taWRkbGV3YXJlQDQuMi4xNC9ub2RlX21vZHVsZXMvQHNtaXRoeS91dGlsLW1pZGRsZXdhcmUvZGlzdC1lcy9ub3JtYWxpemVQcm92aWRlci5qcyIsIm1hcHBpbmdzIjoiOzs7O0FBQU87QUFDUDtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwic291cmNlcyI6WyJDOlxcZGV2XFxtZWRpY2FsLWFxLXFhXFxub2RlX21vZHVsZXNcXC5wbnBtXFxAc21pdGh5K3V0aWwtbWlkZGxld2FyZUA0LjIuMTRcXG5vZGVfbW9kdWxlc1xcQHNtaXRoeVxcdXRpbC1taWRkbGV3YXJlXFxkaXN0LWVzXFxub3JtYWxpemVQcm92aWRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgY29uc3Qgbm9ybWFsaXplUHJvdmlkZXIgPSAoaW5wdXQpID0+IHtcbiAgICBpZiAodHlwZW9mIGlucHV0ID09PSBcImZ1bmN0aW9uXCIpXG4gICAgICAgIHJldHVybiBpbnB1dDtcbiAgICBjb25zdCBwcm9taXNpZmllZCA9IFByb21pc2UucmVzb2x2ZShpbnB1dCk7XG4gICAgcmV0dXJuICgpID0+IHByb21pc2lmaWVkO1xufTtcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+util-middleware@4.2.14/node_modules/@smithy/util-middleware/dist-es/normalizeProvider.js\n");

/***/ })

};
;