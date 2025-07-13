const Database = require('better-sqlite3');
const path = require('path');

// Connect to the database
const dbPath = path.join(__dirname, 'data/chuckafile.db');
const db = new Database(dbPath);

console.log('Cleaning up duplicate friendships...');

try {
  // First, let's see what we have
  const allFriendships = db.prepare(`
    SELECT f.*, u1.username as user_name, u2.username as friend_name 
    FROM friendships f
    JOIN users u1 ON f.user_id = u1.id
    JOIN users u2 ON f.friend_id = u2.id
    ORDER BY f.created_at
  `).all();
  
  console.log('Current friendships:');
  allFriendships.forEach(f => {
    console.log(`${f.user_name} -> ${f.friend_name} (${f.status})`);
  });

  // Delete duplicate friendships - keep only unique pairs
  const deleteDuplicates = db.prepare(`
    DELETE FROM friendships 
    WHERE id NOT IN (
      SELECT MIN(id) 
      FROM friendships 
      GROUP BY 
        CASE 
          WHEN user_id < friend_id THEN user_id || '-' || friend_id 
          ELSE friend_id || '-' || user_id 
        END,
        status
    )
  `);

  const result = deleteDuplicates.run();
  console.log(`Deleted ${result.changes} duplicate friendships`);

  // Show what's left
  const remainingFriendships = db.prepare(`
    SELECT f.*, u1.username as user_name, u2.username as friend_name 
    FROM friendships f
    JOIN users u1 ON f.user_id = u1.id
    JOIN users u2 ON f.friend_id = u2.id
    ORDER BY f.created_at
  `).all();
  
  console.log('\nRemaining friendships:');
  remainingFriendships.forEach(f => {
    console.log(`${f.user_name} -> ${f.friend_name} (${f.status})`);
  });

  console.log('\nCleanup complete!');
} catch (error) {
  console.error('Error cleaning up:', error);
} finally {
  db.close();
}