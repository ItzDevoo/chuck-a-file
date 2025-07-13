import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class DatabaseConnection {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const dbFile = dbPath || path.join(__dirname, '../data/chuckafile.db');
    
    // Ensure data directory exists
    const dataDir = path.dirname(dbFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create database connection
    this.db = new Database(dbFile);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    this.initTables();
  }

  private initTables(): void {
    const queries = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        friend_code TEXT UNIQUE NOT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      )`,

      // Friendships table
      `CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        friend_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (friend_id) REFERENCES users (id),
        UNIQUE(user_id, friend_id)
      )`,

      // Messages table
      `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        message_text TEXT,
        message_type TEXT DEFAULT 'text',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users (id),
        FOREIGN KEY (recipient_id) REFERENCES users (id)
      )`,

      // Files table
      `CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_type TEXT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        message_id INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        downloaded_at DATETIME,
        FOREIGN KEY (sender_id) REFERENCES users (id),
        FOREIGN KEY (recipient_id) REFERENCES users (id),
        FOREIGN KEY (message_id) REFERENCES messages (id)
      )`,

      // Sessions table (for JWT token blacklist)
      `CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`
    ];

    queries.forEach(query => {
      try {
        this.db.exec(query);
      } catch (err) {
        console.error('Error creating table:', err);
      }
    });
  }

  // Helper method to generate unique friend codes
  generateFriendCode(): string {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    return code;
  }

  // Database methods using better-sqlite3 (synchronous but wrapped in promises for API compatibility)
  async run(sql: string, params: any[] = []): Promise<Database.RunResult> {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(...params);
      return result;
    } catch (err) {
      throw err;
    }
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.get(...params);
      return result;
    } catch (err) {
      throw err;
    }
  }

  async all(sql: string, params: any[] = []): Promise<any[]> {
    try {
      const stmt = this.db.prepare(sql);
      const results = stmt.all(...params);
      return results;
    } catch (err) {
      throw err;
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      // Ignore close errors
    }
  }
}

export const db = new DatabaseConnection();