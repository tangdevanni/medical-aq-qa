"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@smithy+url-parser@4.2.14";
exports.ids = ["vendor-chunks/@smithy+url-parser@4.2.14"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/@smithy+url-parser@4.2.14/node_modules/@smithy/url-parser/dist-es/index.js":
/*!***********************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@smithy+url-parser@4.2.14/node_modules/@smithy/url-parser/dist-es/index.js ***!
  \***********************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   parseUrl: () => (/* binding */ parseUrl)\n/* harmony export */ });\n/* harmony import */ var _smithy_querystring_parser__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @smithy/querystring-parser */ \"(rsc)/../../node_modules/.pnpm/@smithy+querystring-parser@4.2.14/node_modules/@smithy/querystring-parser/dist-es/index.js\");\n\nconst parseUrl = (url) => {\n    if (typeof url === \"string\") {\n        return parseUrl(new URL(url));\n    }\n    const { hostname, pathname, port, protocol, search } = url;\n    let query;\n    if (search) {\n        query = (0,_smithy_querystring_parser__WEBPACK_IMPORTED_MODULE_0__.parseQueryString)(search);\n    }\n    return {\n        hostname,\n        port: port ? parseInt(port) : undefined,\n        protocol,\n        path: pathname,\n        query,\n    };\n};\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0BzbWl0aHkrdXJsLXBhcnNlckA0LjIuMTQvbm9kZV9tb2R1bGVzL0BzbWl0aHkvdXJsLXBhcnNlci9kaXN0LWVzL2luZGV4LmpzIiwibWFwcGluZ3MiOiI7Ozs7O0FBQThEO0FBQ3ZEO0FBQ1A7QUFDQTtBQUNBO0FBQ0EsWUFBWSw2Q0FBNkM7QUFDekQ7QUFDQTtBQUNBLGdCQUFnQiw0RUFBZ0I7QUFDaEM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwic291cmNlcyI6WyJDOlxcZGV2XFxtZWRpY2FsLWFxLXFhXFxub2RlX21vZHVsZXNcXC5wbnBtXFxAc21pdGh5K3VybC1wYXJzZXJANC4yLjE0XFxub2RlX21vZHVsZXNcXEBzbWl0aHlcXHVybC1wYXJzZXJcXGRpc3QtZXNcXGluZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHBhcnNlUXVlcnlTdHJpbmcgfSBmcm9tIFwiQHNtaXRoeS9xdWVyeXN0cmluZy1wYXJzZXJcIjtcbmV4cG9ydCBjb25zdCBwYXJzZVVybCA9ICh1cmwpID0+IHtcbiAgICBpZiAodHlwZW9mIHVybCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICByZXR1cm4gcGFyc2VVcmwobmV3IFVSTCh1cmwpKTtcbiAgICB9XG4gICAgY29uc3QgeyBob3N0bmFtZSwgcGF0aG5hbWUsIHBvcnQsIHByb3RvY29sLCBzZWFyY2ggfSA9IHVybDtcbiAgICBsZXQgcXVlcnk7XG4gICAgaWYgKHNlYXJjaCkge1xuICAgICAgICBxdWVyeSA9IHBhcnNlUXVlcnlTdHJpbmcoc2VhcmNoKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgICAgaG9zdG5hbWUsXG4gICAgICAgIHBvcnQ6IHBvcnQgPyBwYXJzZUludChwb3J0KSA6IHVuZGVmaW5lZCxcbiAgICAgICAgcHJvdG9jb2wsXG4gICAgICAgIHBhdGg6IHBhdGhuYW1lLFxuICAgICAgICBxdWVyeSxcbiAgICB9O1xufTtcbiJdLCJuYW1lcyI6W10sImlnbm9yZUxpc3QiOlswXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@smithy+url-parser@4.2.14/node_modules/@smithy/url-parser/dist-es/index.js\n");

/***/ })

};
;