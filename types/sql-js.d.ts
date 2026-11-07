declare module 'sql.js/dist/sql-wasm-browser.js' {
 export type SqlValue = string | number | Uint8Array | null;
 export interface Database {
  exec(sql:string):{columns:string[];values:SqlValue[][]}[];
  run(sql:string,params?:SqlValue[]):void;
  prepare(sql:string):{bind(values:SqlValue[]):void;step():boolean;getAsObject():Record<string,SqlValue>;free():void};
  export():Uint8Array;close():void;
 }
 export default function init(options?:{locateFile?:(file:string)=>string;wasmBinary?:Uint8Array}):Promise<{Database:new(bytes?:Uint8Array)=>Database}>;
}
declare module 'sql.js/dist/sql-asm.js' {
 import type {Database} from 'sql.js/dist/sql-wasm-browser.js';
 export default function init():Promise<{Database:new(bytes?:Uint8Array)=>Database}>;
}
