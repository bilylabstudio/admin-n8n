declare module 'sql.js' {
  export type SqlValue = string | number | Uint8Array | null;

  export type Statement = {
    run(values?: SqlValue[]): void;
    free(): void;
  };

  export type Database = {
    run(sql: string): void;
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  };

  export type SqlJsStatic = {
    Database: new () => Database;
  };

  export type SqlJsConfig = {
    locateFile?: (file: string) => string;
    wasmBinary?: Uint8Array | ArrayBuffer;
  };

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
