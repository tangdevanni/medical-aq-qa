"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@aws-sdk+xml-builder@3.972.18";
exports.ids = ["vendor-chunks/@aws-sdk+xml-builder@3.972.18"];
exports.modules = {

/***/ "(rsc)/../../node_modules/.pnpm/@aws-sdk+xml-builder@3.972.18/node_modules/@aws-sdk/xml-builder/dist-es/xml-parser.js":
/*!**********************************************************************************************************************!*\
  !*** ../../node_modules/.pnpm/@aws-sdk+xml-builder@3.972.18/node_modules/@aws-sdk/xml-builder/dist-es/xml-parser.js ***!
  \**********************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   parseXML: () => (/* binding */ parseXML)\n/* harmony export */ });\n/* harmony import */ var fast_xml_parser__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! fast-xml-parser */ \"(rsc)/../../node_modules/.pnpm/fast-xml-parser@5.5.8/node_modules/fast-xml-parser/src/xmlparser/XMLParser.js\");\n\nconst parser = new fast_xml_parser__WEBPACK_IMPORTED_MODULE_0__[\"default\"]({\n    attributeNamePrefix: \"\",\n    processEntities: {\n        enabled: true,\n        maxTotalExpansions: Infinity,\n    },\n    htmlEntities: true,\n    ignoreAttributes: false,\n    ignoreDeclaration: true,\n    parseTagValue: false,\n    trimValues: false,\n    tagValueProcessor: (_, val) => (val.trim() === \"\" && val.includes(\"\\n\") ? \"\" : undefined),\n    maxNestedTags: Infinity,\n});\nparser.addEntity(\"#xD\", \"\\r\");\nparser.addEntity(\"#10\", \"\\n\");\nfunction parseXML(xmlString) {\n    return parser.parse(xmlString, true);\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi4vLi4vbm9kZV9tb2R1bGVzLy5wbnBtL0Bhd3Mtc2RrK3htbC1idWlsZGVyQDMuOTcyLjE4L25vZGVfbW9kdWxlcy9AYXdzLXNkay94bWwtYnVpbGRlci9kaXN0LWVzL3htbC1wYXJzZXIuanMiLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBNEM7QUFDNUMsbUJBQW1CLHVEQUFTO0FBQzVCO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsQ0FBQztBQUNEO0FBQ0E7QUFDTztBQUNQO0FBQ0EiLCJzb3VyY2VzIjpbIkM6XFxkZXZcXG1lZGljYWwtYXEtcWFcXG5vZGVfbW9kdWxlc1xcLnBucG1cXEBhd3Mtc2RrK3htbC1idWlsZGVyQDMuOTcyLjE4XFxub2RlX21vZHVsZXNcXEBhd3Mtc2RrXFx4bWwtYnVpbGRlclxcZGlzdC1lc1xceG1sLXBhcnNlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBYTUxQYXJzZXIgfSBmcm9tIFwiZmFzdC14bWwtcGFyc2VyXCI7XG5jb25zdCBwYXJzZXIgPSBuZXcgWE1MUGFyc2VyKHtcbiAgICBhdHRyaWJ1dGVOYW1lUHJlZml4OiBcIlwiLFxuICAgIHByb2Nlc3NFbnRpdGllczoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBtYXhUb3RhbEV4cGFuc2lvbnM6IEluZmluaXR5LFxuICAgIH0sXG4gICAgaHRtbEVudGl0aWVzOiB0cnVlLFxuICAgIGlnbm9yZUF0dHJpYnV0ZXM6IGZhbHNlLFxuICAgIGlnbm9yZURlY2xhcmF0aW9uOiB0cnVlLFxuICAgIHBhcnNlVGFnVmFsdWU6IGZhbHNlLFxuICAgIHRyaW1WYWx1ZXM6IGZhbHNlLFxuICAgIHRhZ1ZhbHVlUHJvY2Vzc29yOiAoXywgdmFsKSA9PiAodmFsLnRyaW0oKSA9PT0gXCJcIiAmJiB2YWwuaW5jbHVkZXMoXCJcXG5cIikgPyBcIlwiIDogdW5kZWZpbmVkKSxcbiAgICBtYXhOZXN0ZWRUYWdzOiBJbmZpbml0eSxcbn0pO1xucGFyc2VyLmFkZEVudGl0eShcIiN4RFwiLCBcIlxcclwiKTtcbnBhcnNlci5hZGRFbnRpdHkoXCIjMTBcIiwgXCJcXG5cIik7XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VYTUwoeG1sU3RyaW5nKSB7XG4gICAgcmV0dXJuIHBhcnNlci5wYXJzZSh4bWxTdHJpbmcsIHRydWUpO1xufVxuIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6WzBdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/../../node_modules/.pnpm/@aws-sdk+xml-builder@3.972.18/node_modules/@aws-sdk/xml-builder/dist-es/xml-parser.js\n");

/***/ })

};
;