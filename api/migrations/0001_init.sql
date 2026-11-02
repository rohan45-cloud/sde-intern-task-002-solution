-- Schema for the shared bill splitter.
-- Money is always stored as whole cents (INTEGER). Timestamps are ISO-8601 UTC text.

CREATE TABLE homes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Stops empty or whitespace-only home names.
  CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- 1, 2, 3 ... in the order members joined the home. Decides who gets the extra cents.
  seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Stops a member from pointing at a home that does not exist.
  CONSTRAINT members_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0),
  -- Stops two members of one home from having the same position (e.g. two parallel adds).
  CONSTRAINT members_home_seq_unique UNIQUE (home_id, seq),
  CONSTRAINT members_seq_positive CHECK (seq > 0)
);

CREATE TABLE bills (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT bills_home_fk FOREIGN KEY (home_id) REFERENCES homes (id) ON DELETE CASCADE,
  CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  -- Stops zero and negative bills, even if the API check is bypassed.
  CONSTRAINT bills_total_positive CHECK (total_cents > 0)
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  paid_at TEXT,
  -- The Idempotency-Key that paid this share. Lets a retry get the same answer.
  payment_key TEXT,
  CONSTRAINT shares_bill_fk FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
  CONSTRAINT shares_member_fk FOREIGN KEY (member_id) REFERENCES members (id),
  -- Stops a member from having two shares of the same bill.
  CONSTRAINT shares_bill_member_unique UNIQUE (bill_id, member_id),
  CONSTRAINT shares_amount_not_negative CHECK (amount_cents >= 0),
  -- A share is either unpaid (no time, no key) or paid (both set). Never half paid.
  CONSTRAINT shares_paid_consistent CHECK ((paid_at IS NULL) = (payment_key IS NULL))
);

CREATE INDEX members_home_seq_idx ON members (home_id, seq);
CREATE INDEX bills_home_idx ON bills (home_id, created_at);
CREATE INDEX shares_bill_idx ON shares (bill_id);
CREATE INDEX shares_member_idx ON shares (member_id);
