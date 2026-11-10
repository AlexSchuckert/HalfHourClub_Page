-- Half Hour Clubs schema. Applied by `php bin/console.php install`.
-- Statements are split on semicolons, so keep them out of comments and strings.

CREATE TABLE IF NOT EXISTS settings (
  name VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clubs (
  id CHAR(32) PRIMARY KEY,
  slug VARCHAR(190) NOT NULL,
  title VARCHAR(255) NOT NULL,
  location VARCHAR(255) NOT NULL DEFAULT '',
  date DATE NOT NULL,
  start_time CHAR(5) NOT NULL DEFAULT '',
  end_time CHAR(5) NOT NULL DEFAULT '',
  prompt MEDIUMTEXT NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  UNIQUE KEY clubs_slug (slug),
  KEY clubs_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contributions (
  id CHAR(32) PRIMARY KEY,
  club_id CHAR(32) NOT NULL,
  position INT NOT NULL,
  category VARCHAR(100) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  KEY contributions_club (club_id, position),
  KEY contributions_category (category),
  CONSTRAINT contributions_club_fk FOREIGN KEY (club_id) REFERENCES clubs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contribution_people (
  contribution_id CHAR(32) NOT NULL,
  position INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  PRIMARY KEY (contribution_id, position),
  KEY contribution_people_name (name),
  CONSTRAINT contribution_people_fk FOREIGN KEY (contribution_id) REFERENCES contributions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  name VARCHAR(100) PRIMARY KEY,
  colour VARCHAR(20) NOT NULL,
  position INT NOT NULL DEFAULT 1000
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS people (
  name VARCHAR(100) PRIMARY KEY,
  position INT NOT NULL DEFAULT 1000
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per uploaded file. `name` is what contributions refer to, as
-- media/<name>. Files live in storage/media/<sha256>, so identical uploads share
-- one file. club_id is NULL between upload and the save that uses it.
CREATE TABLE IF NOT EXISTS media (
  name VARCHAR(64) PRIMARY KEY,
  sha256 CHAR(64) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size BIGINT NOT NULL,
  club_id CHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY media_club (club_id),
  KEY media_sha (sha256)
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_general_ci;

-- Old addresses of clubs whose date or title changed.
CREATE TABLE IF NOT EXISTS slug_redirects (
  slug VARCHAR(190) PRIMARY KEY,
  club_id CHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket CHAR(64) PRIMARY KEY,
  hits INT NOT NULL,
  expires_at INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=ascii;
