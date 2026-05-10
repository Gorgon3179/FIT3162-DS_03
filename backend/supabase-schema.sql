-- ============================================================
-- MonashVote Supabase Schema (DBV1 + Auth + Seed)
-- Chạy file này trong Supabase SQL Editor
-- ============================================================

-- ============================================================
-- 1. CLUBS
-- ============================================================
CREATE TABLE IF NOT EXISTS clubs (
    club_id BIGSERIAL PRIMARY KEY,
    club_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. VOTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS voters (
    voter_hash TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. AUTH USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS auth_users (
    auth_user_id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    voter_hash TEXT REFERENCES voters(voter_hash),
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- ============================================================
-- 4. VERIFICATION CODES
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_codes (
    verification_code_id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);

-- ============================================================
-- 5. TRAIT CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS trait_categories (
    trait_category_id BIGSERIAL PRIMARY KEY,
    category_name TEXT NOT NULL UNIQUE,
    display_order INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 6. TRAITS
-- ============================================================
CREATE TABLE IF NOT EXISTS traits (
    trait_id BIGSERIAL PRIMARY KEY,
    trait_category_id BIGINT NOT NULL REFERENCES trait_categories(trait_category_id) ON DELETE CASCADE,
    trait_name TEXT NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INT,
    is_free_text BOOLEAN NOT NULL DEFAULT FALSE,
    is_multi_options BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 7. TRAIT OPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS trait_options (
    trait_option_id BIGSERIAL PRIMARY KEY,
    trait_id BIGINT NOT NULL REFERENCES traits(trait_id) ON DELETE CASCADE,
    option_value TEXT NOT NULL,
    display_order INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 8. ELECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS elections (
    election_id BIGSERIAL PRIMARY KEY,
    club_id BIGINT NOT NULL REFERENCES clubs(club_id) ON DELETE CASCADE,
    election_name TEXT NOT NULL,
    description TEXT,
    election_type TEXT NOT NULL DEFAULT 'IRV',
    status TEXT NOT NULL DEFAULT 'draft',
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at)
);

-- ============================================================
-- 9. ELECTION CANDIDATES
-- ============================================================
CREATE TABLE IF NOT EXISTS election_candidates (
    candidate_id BIGSERIAL PRIMARY KEY,
    election_id BIGINT NOT NULL REFERENCES elections(election_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    bio TEXT,
    ballot_order INT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. VOTER TRAIT OPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS voter_trait_options (
    voter_trait_response_id BIGSERIAL PRIMARY KEY,
    voter_hash TEXT NOT NULL REFERENCES voters(voter_hash) ON DELETE CASCADE,
    trait_option_id BIGINT NOT NULL REFERENCES trait_options(trait_option_id) ON DELETE CASCADE,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensures only one active entry per (voter_hash, trait_option_id) at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_current_trait_per_voter_option
ON voter_trait_options (voter_hash, trait_option_id)
WHERE is_current = TRUE;

-- ============================================================
-- 11. BALLOT SUBMISSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS ballot_submissions (
    ballot_submission_id BIGSERIAL PRIMARY KEY,
    election_id BIGINT NOT NULL REFERENCES elections(election_id) ON DELETE CASCADE,
    voter_hash TEXT NOT NULL REFERENCES voters(voter_hash) ON DELETE CASCADE,
    submission_number INT NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    replaced_at TIMESTAMPTZ,
    replaced_ballot_submission_id BIGINT REFERENCES ballot_submissions(ballot_submission_id),
    UNIQUE (election_id, voter_hash, submission_number),
    CHECK (submission_number > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_current_ballot_per_voter_election
ON ballot_submissions (election_id, voter_hash)
WHERE is_current = TRUE;

-- ============================================================
-- 12. BALLOT RANKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ballot_rankings (
    ballot_ranking_id BIGSERIAL PRIMARY KEY,
    ballot_submission_id BIGINT NOT NULL REFERENCES ballot_submissions(ballot_submission_id) ON DELETE CASCADE,
    candidate_id BIGINT NOT NULL REFERENCES election_candidates(candidate_id) ON DELETE CASCADE,
    rank_position INT NOT NULL CHECK (rank_position > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ballot_submission_id, rank_position),
    UNIQUE (ballot_submission_id, candidate_id)
);

-- ============================================================
-- 13. BALLOT VOTE
-- ============================================================
CREATE TABLE IF NOT EXISTS ballot_vote (
    ballot_elections_trait_options_id BIGSERIAL PRIMARY KEY,
    voter_hash TEXT NOT NULL REFERENCES voters(voter_hash) ON DELETE CASCADE,
    trait_option_id BIGINT NOT NULL REFERENCES trait_options(trait_option_id) ON DELETE CASCADE,
    election_id BIGINT NOT NULL REFERENCES elections(election_id) ON DELETE CASCADE,
    ballot_submission_id BIGINT REFERENCES ballot_submissions(ballot_submission_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 14. ELECTION WHITELIST
-- ============================================================
CREATE TABLE IF NOT EXISTS election_whitelist (
    whitelist_id BIGSERIAL PRIMARY KEY,
    voter_hash TEXT NOT NULL REFERENCES voters(voter_hash) ON DELETE CASCADE,
    election_id BIGINT NOT NULL REFERENCES elections(election_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (voter_hash, election_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_elections_club ON elections(club_id);
CREATE INDEX IF NOT EXISTS idx_elections_status ON elections(status);
CREATE INDEX IF NOT EXISTS idx_elections_ends_at ON elections(ends_at);
CREATE INDEX IF NOT EXISTS idx_election_candidates_election ON election_candidates(election_id);
CREATE INDEX IF NOT EXISTS idx_traits_category ON traits(trait_category_id);
CREATE INDEX IF NOT EXISTS idx_trait_options_trait ON trait_options(trait_id);
CREATE INDEX IF NOT EXISTS idx_voter_trait_options_voter ON voter_trait_options(voter_hash);
CREATE INDEX IF NOT EXISTS idx_voter_trait_options_option ON voter_trait_options(trait_option_id);
CREATE INDEX IF NOT EXISTS idx_ballot_submissions_election ON ballot_submissions(election_id);
CREATE INDEX IF NOT EXISTS idx_ballot_submissions_voter ON ballot_submissions(voter_hash);
CREATE INDEX IF NOT EXISTS idx_ballot_submissions_election_voter ON ballot_submissions(election_id, voter_hash);
CREATE INDEX IF NOT EXISTS idx_ballot_submissions_current ON ballot_submissions(election_id, is_current);
CREATE INDEX IF NOT EXISTS idx_ballot_submissions_replaced ON ballot_submissions(replaced_ballot_submission_id);
CREATE INDEX IF NOT EXISTS idx_ballot_rankings_submission ON ballot_rankings(ballot_submission_id);
CREATE INDEX IF NOT EXISTS idx_ballot_rankings_candidate ON ballot_rankings(candidate_id);
CREATE INDEX IF NOT EXISTS idx_ballot_rankings_rank ON ballot_rankings(rank_position);
CREATE INDEX IF NOT EXISTS idx_ballot_vote_election ON ballot_vote(election_id);
CREATE INDEX IF NOT EXISTS idx_ballot_vote_voter ON ballot_vote(voter_hash);
CREATE INDEX IF NOT EXISTS idx_ballot_vote_trait_option ON ballot_vote(trait_option_id);
CREATE INDEX IF NOT EXISTS idx_ballot_vote_election_option ON ballot_vote(election_id, trait_option_id);
CREATE INDEX IF NOT EXISTS idx_ballot_vote_submission ON ballot_vote(ballot_submission_id);
CREATE INDEX IF NOT EXISTS idx_election_whitelist_election ON election_whitelist(election_id);
CREATE INDEX IF NOT EXISTS idx_election_whitelist_voter ON election_whitelist(voter_hash);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_users_voter_hash ON auth_users(voter_hash);

-- ============================================================
-- SEED DATA: trait_categories (1-8)
-- ============================================================
INSERT INTO trait_categories (trait_category_id, category_name, display_order) VALUES
  (1, 'Monash Affiliation', 1),
  (2, 'Course Info', 2),
  (3, 'Club Membership', 3),
  (4, 'Engagement & Interests', 4),
  (5, 'Academic Context', 5),
  (6, 'Location & Logistics', 6),
  (7, 'Accessibility & Inclusion', 7),
  (8, 'Demographics', 8)
ON CONFLICT (trait_category_id) DO NOTHING;

-- ============================================================
-- SEED DATA: traits (1-28)
-- ============================================================
INSERT INTO traits (trait_id, trait_category_id, trait_name, is_required, display_order, is_free_text, is_multi_options) VALUES
  (1,  1, 'Affiliation',              TRUE,  1,  FALSE, FALSE),
  (2,  1, 'Campus',                   TRUE,  2,  FALSE, FALSE),
  (3,  1, 'Faculty',                  TRUE,  3,  FALSE, FALSE),
  (4,  2, 'Course Level',             FALSE, 4,  FALSE, FALSE),
  (5,  2, 'Year of Study',            FALSE, 5,  FALSE, FALSE),
  (6,  2, 'Domestic vs International',FALSE, 6,  FALSE, FALSE),
  (7,  3, 'Membership Status',        FALSE, 7,  FALSE, FALSE),
  (8,  3, 'Club Role',                FALSE, 8,  FALSE, FALSE),
  (9,  3, 'Financial Member',         FALSE, 9,  FALSE, FALSE),
  (10, 3, 'Minimum Attendance Met',   FALSE, 10, FALSE, FALSE),
  (11, 4, 'Event Attendance',         FALSE, 11, FALSE, FALSE),
  (12, 4, 'Preferred Event Types',    FALSE, 12, FALSE, TRUE),
  (13, 4, 'Availability Windows',     FALSE, 13, FALSE, TRUE),
  (14, 4, 'Communication Preference', FALSE, 14, FALSE, TRUE),
  (15, 4, 'Volunteering Interest',    FALSE, 15, FALSE, TRUE),
  (16, 5, 'Major Stream',             FALSE, 16, FALSE, FALSE),
  (17, 5, 'Study Load',               FALSE, 17, FALSE, FALSE),
  (18, 5, 'Scholar Program',          FALSE, 18, FALSE, FALSE),
  (19, 6, 'Commute Mode',             FALSE, 19, FALSE, FALSE),
  (20, 6, 'Residence Proximity',      FALSE, 20, FALSE, FALSE),
  (21, 6, 'Time Zone',                FALSE, 21, FALSE, FALSE),
  (22, 7, 'Accessibility Needs',      FALSE, 22, FALSE, TRUE),
  (23, 7, 'Dietary Requirements',     FALSE, 23, FALSE, TRUE),
  (24, 7, 'Pronouns',                 FALSE, 24, FALSE, FALSE),
  (25, 8, 'Age Band',                 FALSE, 25, FALSE, FALSE),
  (26, 8, 'Gender',                   FALSE, 26, FALSE, FALSE),
  (27, 8, 'Language At Home',         FALSE, 27, FALSE, FALSE),
  (28, 8, 'First In Family At Uni',   FALSE, 28, FALSE, FALSE)
ON CONFLICT (trait_id) DO NOTHING;

-- ============================================================
-- SEED DATA: trait_options (1-115)
-- ============================================================
INSERT INTO trait_options (trait_option_id, trait_id, option_value, display_order) VALUES
  -- Trait 1 – Affiliation (3)
  (1,   1, 'Student', 1), (2, 1, 'Staff', 2), (3, 1, 'Alum', 3),
  -- Trait 2 – Campus (6)
  (4,   2, 'Clayton', 1), (5, 2, 'Caulfield', 2), (6, 2, 'Peninsula', 3),
  (7,   2, 'Parkville', 4), (8, 2, 'Malaysia', 5), (9, 2, 'Online', 6),
  -- Trait 3 – Faculty (9)
  (10,  3, 'IT', 1), (11, 3, 'Engineering', 2), (12, 3, 'Science', 3),
  (13,  3, 'Arts', 4), (14, 3, 'Business & Economics', 5),
  (15,  3, 'Law', 6), (16, 3, 'Medicine Nursing & Health Sciences', 7),
  (17,  3, 'Education', 8), (18, 3, 'MADA', 9),
  -- Trait 4 – Course Level (3)
  (19,  4, 'Undergrad', 1), (20, 4, 'Postgrad Coursework', 2), (21, 4, 'HDR', 3),
  -- Trait 5 – Year of Study (5)
  (22,  5, '1', 1), (23, 5, '2', 2), (24, 5, '3', 3),
  (25,  5, '4', 4), (26, 5, 'Greater Than 4', 5),
  -- Trait 6 – Domestic vs International (2)
  (27,  6, 'Domestic', 1), (28, 6, 'International', 2),
  -- Trait 7 – Membership Status (3)
  (29,  7, 'Current Member', 1), (30, 7, 'Non-member', 2), (31, 7, 'Lapsed', 3),
  -- Trait 8 – Club Role (3)
  (32,  8, 'General Member', 1), (33, 8, 'Committee', 2), (34, 8, 'Office Bearer', 3),
  -- Trait 9 – Financial Member (2)
  (35,  9, 'Yes', 1), (36, 9, 'No', 2),
  -- Trait 10 – Minimum Attendance Met (2)
  (37, 10, 'Yes', 1), (38, 10, 'No', 2),
  -- Trait 11 – Event Attendance (4)
  (39, 11, '0', 1), (40, 11, '1-2', 2), (41, 11, '3-5', 3), (42, 11, '6+', 4),
  -- Trait 12 – Preferred Event Types (6)
  (43, 12, 'Social', 1), (44, 12, 'Academic', 2), (45, 12, 'Industry', 3),
  (46, 12, 'Volunteering', 4), (47, 12, 'Sports', 5), (48, 12, 'Competitions', 6),
  -- Trait 13 – Availability Windows (3)
  (49, 13, 'Weekday Evenings', 1), (50, 13, 'Weekends', 2), (51, 13, 'Lunchtime Slots', 3),
  -- Trait 14 – Communication Preference (5)
  (52, 14, 'Email', 1), (53, 14, 'WhatsApp', 2), (54, 14, 'Facebook', 3),
  (55, 14, 'Instagram', 4), (56, 14, 'Discord', 5),
  -- Trait 15 – Volunteering Interest (5)
  (57, 15, 'Mentoring', 1), (58, 15, 'Logistics', 2), (59, 15, 'Sponsorship', 3),
  (60, 15, 'Marketing', 4), (61, 15, 'Tech', 5),
  -- Trait 16 – Major Stream (5)
  (62, 16, 'Software Engineering', 1), (63, 16, 'Cybersecurity', 2),
  (64, 16, 'Data Science', 3), (65, 16, 'Networks', 4), (66, 16, 'Other', 5),
  -- Trait 17 – Study Load (2)
  (67, 17, 'Full-time', 1), (68, 17, 'Part-time', 2),
  -- Trait 18 – Scholar Program (2)
  (69, 18, 'Yes', 1), (70, 18, 'No', 2),
  -- Trait 19 – Commute Mode (4)
  (71, 19, 'PT', 1), (72, 19, 'Drive', 2), (73, 19, 'Walk', 3), (74, 19, 'Cycle', 4),
  -- Trait 20 – Residence Proximity (4)
  (75, 20, 'On-campus', 1), (76, 20, 'Less Than 5 km', 2),
  (77, 20, '5-15 km', 3), (78, 20, 'Greater Than 15 km', 4),
  -- Trait 21 – Time Zone (4)
  (79, 21, 'AEDT', 1), (80, 21, 'AEST', 2), (81, 21, 'MYT', 3), (82, 21, 'UTC+8', 4),
  -- Trait 22 – Accessibility Needs (5)
  (83, 22, 'Vision Support', 1), (84, 22, 'Hearing Support', 2),
  (85, 22, 'Mobility Support', 3), (86, 22, 'Neurodivergent Support', 4), (87, 22, 'Other', 5),
  -- Trait 23 – Dietary Requirements (6)
  (88, 23, 'Veg', 1), (89, 23, 'Vegan', 2), (90, 23, 'Halal', 3),
  (91, 23, 'Kosher', 4), (92, 23, 'GF', 5), (93, 23, 'Allergies', 6),
  -- Trait 24 – Pronouns (4)
  (94, 24, 'He/Him', 1), (95, 24, 'She/Her', 2), (96, 24, 'They/Them', 3), (97, 24, 'Prefer Not To Say', 4),
  -- Trait 25 – Age Band (5)
  (98, 25, 'Under 18', 1), (99, 25, '18-20', 2), (100, 25, '21-24', 3),
  (101, 25, '25-30', 4), (102, 25, '30+', 5),
  -- Trait 26 – Gender (5)
  (103, 26, 'Male', 1), (104, 26, 'Female', 2), (105, 26, 'Non-binary', 3),
  (106, 26, 'Self-describe', 4), (107, 26, 'Prefer Not To Say', 5),
  -- Trait 27 – Language At Home (6)
  (108, 27, 'English', 1), (109, 27, 'Mandarin', 2), (110, 27, 'Cantonese', 3),
  (111, 27, 'Hindi', 4), (112, 27, 'Malay', 5), (113, 27, 'Other', 6),
  -- Trait 28 – First In Family At Uni (2)
  (114, 28, 'Yes', 1), (115, 28, 'No', 2)
ON CONFLICT (trait_option_id) DO NOTHING;

-- ============================================================
-- SEED DATA: clubs
-- ============================================================
INSERT INTO clubs (club_id, club_name, description)
VALUES
  (1, 'Monash Computer Science Club', 'Official club for CS students at Monash'),
  (2, 'Monash Engineering Society', 'Engineering student society')
ON CONFLICT (club_id) DO NOTHING;

-- ============================================================
-- SEED DATA: elections (for testing)
-- ============================================================
INSERT INTO elections (election_id, club_id, election_name, description, election_type, status, starts_at, ends_at)
VALUES
  (1, 1, 'Club 1 President Election', 'Vote for the next president of CS Club', 'IRV', 'open',
   NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days'),
  (2, 2, 'Club 2 President Election', 'Vote for the next president of Engineering Society', 'IRV', 'open',
   NOW() - INTERVAL '1 day', NOW() + INTERVAL '14 days')
ON CONFLICT (election_id) DO NOTHING;

-- ============================================================
-- SEED DATA: election_candidates
-- ============================================================
INSERT INTO election_candidates (candidate_id, election_id, display_name, bio, ballot_order)
VALUES
  (1, 1, 'Candidate 1', 'Computer Science, Year 3', 1),
  (2, 1, 'Candidate 2', 'Engineering, Year 2', 2),
  (3, 1, 'Candidate 3', 'Business, Year 4', 3),
  (4, 1, 'Candidate 4', 'Science, Year 1', 4),
  (5, 1, 'Candidate 5', 'Arts, Year 3', 5),
  (6, 2, 'Candidate A', 'Arts, Year 2', 1),
  (7, 2, 'Candidate B', 'Science, Year 3', 2),
  (8, 2, 'Candidate C', 'Business, Year 1', 3)
ON CONFLICT (candidate_id) DO NOTHING;

-- ============================================================
-- Reset sequences after seeding
-- ============================================================
SELECT setval('trait_categories_trait_category_id_seq', (SELECT MAX(trait_category_id) FROM trait_categories));
SELECT setval('traits_trait_id_seq', (SELECT MAX(trait_id) FROM traits));
SELECT setval('trait_options_trait_option_id_seq', (SELECT MAX(trait_option_id) FROM trait_options));
SELECT setval('clubs_club_id_seq', (SELECT MAX(club_id) FROM clubs));
SELECT setval('elections_election_id_seq', (SELECT MAX(election_id) FROM elections));
SELECT setval('election_candidates_candidate_id_seq', (SELECT MAX(candidate_id) FROM election_candidates));
