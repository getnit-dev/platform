-- Migration: Add name column to virtual_keys table
-- This allows users to give descriptive names to their LLM keys

ALTER TABLE virtual_keys ADD COLUMN name TEXT;

CREATE INDEX idx_virtual_keys_name ON virtual_keys(name);
