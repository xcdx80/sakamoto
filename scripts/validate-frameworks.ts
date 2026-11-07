import { loadCatalog } from "../lib/post-production/catalog";

const catalog = loadCatalog();
console.log(JSON.stringify({ frameworks: catalog.frameworks.length, hooks: catalog.hooks.length, signals: catalog.signals.length, version: catalog.version }));
