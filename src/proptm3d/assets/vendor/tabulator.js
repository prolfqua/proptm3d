// The table renderer, pinned in one place (same stack as rawDIAGQC).
// TabulatorFull is the build with every module compiled in -- sorting, header
// filters and formatters work without registering modules by hand. Its
// stylesheet is a separate pinned <link> in lit.html.
export { TabulatorFull } from 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.5.2/+esm'
