"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@smithy+util-config-provider@4.2.2";
exports.ids = ["vendor-chunks/@smithy+util-config-provider@4.2.2"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/booleanSelector.js":
/*!****************************************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/booleanSelector.js ***!
  \****************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   booleanSelector: () => (/* binding */ booleanSelector)\n/* harmony export */ });\nconst booleanSelector = (obj, key, type) => {\n    if (!(key in obj))\n        return undefined;\n    if (obj[key] === \"true\")\n        return true;\n    if (obj[key] === \"false\")\n        return false;\n    throw new Error(`Cannot load ${type} \"${key}\". Expected \"true\" or \"false\", got ${obj[key]}.`);\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXRpbC1jb25maWctcHJvdmlkZXJANC4yLjIvbm9kZV9tb2R1bGVzL0BzbWl0aHkvdXRpbC1jb25maWctcHJvdmlkZXIvZGlzdC1lcy9ib29sZWFuU2VsZWN0b3IuanMiLCJtYXBwaW5ncyI6Ijs7OztBQUFPO0FBQ1A7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsbUNBQW1DLE1BQU0sR0FBRyxJQUFJLHFDQUFxQyxTQUFTO0FBQzlGIiwic291cmNlcyI6WyJDOlxcZGV2XFxtZWRpY2FsLWFxLXFhXFxub2RlX21vZHVsZXNcXC5wbnBtXFxAc21pdGh5K3V0aWwtY29uZmlnLXByb3ZpZGVyQDQuMi4yXFxub2RlX21vZHVsZXNcXEBzbWl0aHlcXHV0aWwtY29uZmlnLXByb3ZpZGVyXFxkaXN0LWVzXFxib29sZWFuU2VsZWN0b3IuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IGNvbnN0IGJvb2xlYW5TZWxlY3RvciA9IChvYmosIGtleSwgdHlwZSkgPT4ge1xuICAgIGlmICghKGtleSBpbiBvYmopKVxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmIChvYmpba2V5XSA9PT0gXCJ0cnVlXCIpXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIGlmIChvYmpba2V5XSA9PT0gXCJmYWxzZVwiKVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgbG9hZCAke3R5cGV9IFwiJHtrZXl9XCIuIEV4cGVjdGVkIFwidHJ1ZVwiIG9yIFwiZmFsc2VcIiwgZ290ICR7b2JqW2tleV19LmApO1xufTtcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/booleanSelector.js\n");

/***/ }),

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/types.js":
/*!******************************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/types.js ***!
  \******************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   SelectorType: () => (/* binding */ SelectorType)\n/* harmony export */ });\nvar SelectorType;\n(function (SelectorType) {\n    SelectorType[\"ENV\"] = \"env\";\n    SelectorType[\"CONFIG\"] = \"shared config entry\";\n})(SelectorType || (SelectorType = {}));\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXRpbC1jb25maWctcHJvdmlkZXJANC4yLjIvbm9kZV9tb2R1bGVzL0BzbWl0aHkvdXRpbC1jb25maWctcHJvdmlkZXIvZGlzdC1lcy90eXBlcy5qcyIsIm1hcHBpbmdzIjoiOzs7O0FBQU87QUFDUDtBQUNBO0FBQ0E7QUFDQSxDQUFDLG9DQUFvQyIsInNvdXJjZXMiOlsiQzpcXGRldlxcbWVkaWNhbC1hcS1xYVxcbm9kZV9tb2R1bGVzXFwucG5wbVxcQHNtaXRoeSt1dGlsLWNvbmZpZy1wcm92aWRlckA0LjIuMlxcbm9kZV9tb2R1bGVzXFxAc21pdGh5XFx1dGlsLWNvbmZpZy1wcm92aWRlclxcZGlzdC1lc1xcdHlwZXMuanMiXSwic291cmNlc0NvbnRlbnQiOlsiZXhwb3J0IHZhciBTZWxlY3RvclR5cGU7XG4oZnVuY3Rpb24gKFNlbGVjdG9yVHlwZSkge1xuICAgIFNlbGVjdG9yVHlwZVtcIkVOVlwiXSA9IFwiZW52XCI7XG4gICAgU2VsZWN0b3JUeXBlW1wiQ09ORklHXCJdID0gXCJzaGFyZWQgY29uZmlnIGVudHJ5XCI7XG59KShTZWxlY3RvclR5cGUgfHwgKFNlbGVjdG9yVHlwZSA9IHt9KSk7XG4iXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbMF0sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+util-config-provider@4.2.2/node_modules/@smithy/util-config-provider/dist-es/types.js\n");

/***/ })

};
;