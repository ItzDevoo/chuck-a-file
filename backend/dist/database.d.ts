import Database from 'better-sqlite3';
export declare class DatabaseConnection {
    private db;
    constructor(dbPath?: string);
    private initTables;
    generateFriendCode(): string;
    run(sql: string, params?: any[]): Promise<Database.RunResult>;
    get(sql: string, params?: any[]): Promise<any>;
    all(sql: string, params?: any[]): Promise<any[]>;
    close(): Promise<void>;
}
export declare const db: DatabaseConnection;
//# sourceMappingURL=database.d.ts.map