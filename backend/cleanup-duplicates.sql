-- Script to clean up duplicate friendships
-- Run this to remove duplicate friend entries

-- Delete duplicate friendships (keep only one direction until proper requests)
DELETE FROM friendships 
WHERE id NOT IN (
  SELECT MIN(id) 
  FROM friendships 
  GROUP BY 
    CASE 
      WHEN user_id < friend_id THEN user_id || '-' || friend_id 
      ELSE friend_id || '-' || user_id 
    END
);

-- Reset all friendships to pending for testing
UPDATE friendships SET status = 'pending';