# generate_monashvote_seed.py

import argparse
import csv
import hashlib
import random
import secrets
from datetime import datetime, timedelta
from pathlib import Path

# keep your existing TRAITS, WEIGHTS, CANDIDATES dictionaries here
# from your current file

# IMPORTANT:
# paste your existing TRAITS, WEIGHTS, CANDIDATES above this line

WEIGHTS = {
    1: [0.92, 0.05, 0.03],
    2: [0.48, 0.22, 0.08, 0.05, 0.10, 0.07],
    3: [0.22, 0.16, 0.13, 0.10, 0.16, 0.05, 0.10, 0.04, 0.04],
    4: [0.78, 0.18, 0.04],
    5: [0.28, 0.25, 0.22, 0.17, 0.08],
    6: [0.62, 0.38],
    7: [0.72, 0.18, 0.10],
    8: [0.82, 0.13, 0.05],
    9: [0.76, 0.24],
    10: [0.70, 0.30],
    11: [0.16, 0.32, 0.34, 0.18],
    12: [0.24, 0.18, 0.20, 0.10, 0.14, 0.14],
    13: [0.45, 0.35, 0.20],
    14: [0.42, 0.16, 0.08, 0.18, 0.16],
    15: [0.18, 0.18, 0.16, 0.20, 0.28],
    16: [0.24, 0.18, 0.30, 0.12, 0.16],
    17: [0.86, 0.14],
    18: [0.18, 0.82],
    19: [0.58, 0.24, 0.10, 0.08],
    20: [0.16, 0.26, 0.36, 0.22],
    21: [0.70, 0.16, 0.10, 0.04],
    22: [0.10, 0.08, 0.05, 0.18, 0.59],
    23: [0.18, 0.10, 0.18, 0.04, 0.08, 0.42],
    24: [0.42, 0.42, 0.08, 0.08],
    25: [0.02, 0.46, 0.36, 0.11, 0.05],
    26: [0.46, 0.46, 0.04, 0.02, 0.02],
    27: [0.58, 0.14, 0.08, 0.06, 0.05, 0.09],
    28: [0.34, 0.66],
}
TRAITS = {
    1: [1, 2, 3],
    2: [4, 5, 6, 7, 8, 9],
    3: [10, 11, 12, 13, 14, 15, 16, 17, 18],
    4: [19, 20, 21],
    5: [22, 23, 24, 25, 26],
    6: [27, 28],
    7: [29, 30, 31],
    8: [32, 33, 34],
    9: [35, 36],
    10: [37, 38],
    11: [39, 40, 41, 42],
    12: [43, 44, 45, 46, 47, 48],
    13: [49, 50, 51],
    14: [52, 53, 54, 55, 56],
    15: [57, 58, 59, 60, 61],
    16: [62, 63, 64, 65, 66],
    17: [67, 68],
    18: [69, 70],
    19: [71, 72, 73, 74],
    20: [75, 76, 77, 78],
    21: [79, 80, 81, 82],
    22: [83, 84, 85, 86, 87],
    23: [88, 89, 90, 91, 92, 93],
    24: [94, 95, 96, 97],
    25: [98, 99, 100, 101, 102],
    26: [103, 104, 105, 106, 107],
    27: [108, 109, 110, 111, 112, 113],
    28: [114, 115],
}
CANDIDATES = [
    (1, "Candidate 1", "Year 3 · Computer Science"),
    (2, "Candidate 2", "Year 2 · Data Science"),
    (3, "Candidate 3", "Year 4 · Software Engineering"),
    (4, "Candidate 4", "Postgrad · Cybersecurity"),
    (5, "Candidate 5", "Year 3 · Business Information Systems"),
]

def weighted_choice(options, weights):
    return random.choices(options, weights=weights, k=1)[0]

def rand_time(start, end):
    seconds = max(1, int((end - start).total_seconds()))
    return start + timedelta(seconds=random.randint(0, seconds))

def voter_hash(i):
    raw = f"sim_user_{i}_{secrets.token_hex(8)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]

def write_csv(path, rows):
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

def generate_traits():
    selected = {}
    for trait_id, option_ids in TRAITS.items():
        selected[trait_id] = weighted_choice(option_ids, WEIGHTS[trait_id])
    return selected

def mutate_traits(current_traits, max_changes=4):
    updated = dict(current_traits)
    traits_to_change = random.sample(list(TRAITS.keys()), random.randint(1, max_changes))

    for trait_id in traits_to_change:
        old_option = updated[trait_id]
        possible = [x for x in TRAITS[trait_id] if x != old_option]
        updated[trait_id] = weighted_choice(possible, [1] * len(possible))

    return updated

def make_rankings(voter_traits):
    faculty = voter_traits.get(3)
    major = voter_traits.get(16)
    year = voter_traits.get(5)

    scores = {cid: random.uniform(0.6, 1.4) for cid in range(1, 6)}

    if faculty == 10:
        scores[1] += 0.5
        scores[2] += 0.3
    if major == 64:
        scores[2] += 0.7
    if major == 62:
        scores[3] += 0.6
    if major == 63:
        scores[4] += 0.7
    if year in [25, 26]:
        scores[3] += 0.3
        scores[4] += 0.3

    ordered = sorted(scores.keys(), key=lambda c: scores[c], reverse=True)
    rank_count = random.choices([1, 2, 3, 4, 5], weights=[0.10, 0.16, 0.26, 0.22, 0.26], k=1)[0]
    return [{"candidate_id": cid, "rank_position": i + 1} for i, cid in enumerate(ordered[:rank_count])]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--votes", type=int, default=500)
    parser.add_argument("--daily-trait-change-percent", type=float, default=5.0)
    parser.add_argument("--daily-vote-change-percent", type=float, default=8.0)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--out", default="monashvote_seed_csv")
    parser.add_argument("--election-id", type=int, default=1)
    parser.add_argument("--club-id", type=int, default=1)
    parser.add_argument("--election-title", default="Simulated Club President Election")
    args = parser.parse_args()

    start = datetime.fromisoformat(args.start)
    end = datetime.fromisoformat(args.end)
    out = Path(args.out)
    out.mkdir(exist_ok=True)

    clubs = [{
        "club_id": args.club_id,
        "club_name": "Monash Data Science Club",
        "description": "Simulated club for MonashVote election testing",
        "created_at": start.isoformat()
    }]

    elections = [{
        "election_id": args.election_id,
        "club_id": args.club_id,
        "election_name": args.election_title,
        "description": "Generated multi-day election with trait changes and revotes",
        "election_type": "IRV",
        "status": "open",
        "is_private": False,
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "created_at": start.isoformat()
    }]

    candidates = []
    order = list(range(1, len(CANDIDATES) + 1))
    random.shuffle(order)

    for idx, (cid, name, bio) in enumerate(CANDIDATES):
        candidates.append({
            "candidate_id": cid,
            "election_id": args.election_id,
            "display_name": name,
            "bio": bio,
            "ballot_order": order[idx],
            "is_active": True,
            "created_at": start.isoformat()
        })

    voters = []
    voter_trait_options = []
    ballot_submissions = []
    ballot_rankings = []
    ballot_vote = []

    voter_trait_response_id = 1
    ballot_submission_id = 1
    ballot_ranking_id = 1
    ballot_vote_id = 1

    voter_records = []

    def insert_current_traits(vh, traits, created_at):
        nonlocal voter_trait_response_id

        for row in voter_trait_options:
            if row["voter_hash"] == vh and row["is_current"] is True:
                row["is_current"] = False
                row["last_updated_at"] = created_at.isoformat()

        for opt in traits.values():
            voter_trait_options.append({
                "voter_trait_response_id": voter_trait_response_id,
                "voter_hash": vh,
                "trait_option_id": opt,
                "is_current": True,
                "created_at": created_at.isoformat(),
                "last_updated_at": created_at.isoformat()
            })
            voter_trait_response_id += 1

    def insert_vote(vh, traits, submitted_at):
        nonlocal ballot_submission_id, ballot_ranking_id, ballot_vote_id

        current = [
            b for b in ballot_submissions
            if b["voter_hash"] == vh
            and b["election_id"] == args.election_id
            and b["is_current"] is True
        ]

        old_id = ""
        submission_number = 1

        if current:
            old = current[-1]
            old["is_current"] = False
            old["replaced_at"] = submitted_at.isoformat()
            old_id = old["ballot_submission_id"]
            submission_number = old["submission_number"] + 1

        ballot_submissions.append({
            "ballot_submission_id": ballot_submission_id,
            "election_id": args.election_id,
            "voter_hash": vh,
            "submission_number": submission_number,
            "submitted_at": submitted_at.isoformat(),
            "is_current": True,
            "replaced_at": "",
            "replaced_ballot_submission_id": old_id
        })

        rankings = make_rankings(traits)

        for r in rankings:
            ballot_rankings.append({
                "ballot_ranking_id": ballot_ranking_id,
                "ballot_submission_id": ballot_submission_id,
                "candidate_id": r["candidate_id"],
                "rank_position": r["rank_position"],
                "created_at": submitted_at.isoformat()
            })
            ballot_ranking_id += 1

        for opt in traits.values():
            ballot_vote.append({
                "ballot_elections_trait_options_id": ballot_vote_id,
                "ballot_submission_id": ballot_submission_id,
                "voter_hash": vh,
                "election_id": args.election_id,
                "trait_option_id": opt,
                "created_at": submitted_at.isoformat()
            })
            ballot_vote_id += 1

        ballot_submission_id += 1

    # initial voters
    for i in range(1, args.votes + 1):
        vh = voter_hash(i)
        traits = generate_traits()
        created_at = rand_time(start, start + timedelta(hours=6))

        voters.append({
            "voter_hash": vh,
            "salt": secrets.token_hex(16),
            "created_at": created_at.isoformat()
        })

        insert_current_traits(vh, traits, created_at)
        voter_records.append({"voter_hash": vh, "traits": traits})

    # initial votes spread across election
    for voter in voter_records:
        insert_vote(
            voter["voter_hash"],
            voter["traits"],
            rand_time(start, end)
        )

    # daily independent trait changes and revotes
    total_days = max(1, (end.date() - start.date()).days + 1)

    for day in range(1, total_days):
        day_start = start + timedelta(days=day)
        day_end = min(day_start + timedelta(days=1), end)
        if day_start >= end:
            break

        trait_change_count = int(args.votes * (args.daily_trait_change_percent / 100))
        vote_change_count = int(args.votes * (args.daily_vote_change_percent / 100))

        trait_changers = random.sample(voter_records, min(trait_change_count, len(voter_records)))
        vote_changers = random.sample(voter_records, min(vote_change_count, len(voter_records)))

        for voter in trait_changers:
            change_time = rand_time(day_start, day_end)
            voter["traits"] = mutate_traits(voter["traits"])
            insert_current_traits(voter["voter_hash"], voter["traits"], change_time)

        for voter in vote_changers:
            vote_time = rand_time(day_start, day_end)
            insert_vote(voter["voter_hash"], voter["traits"], vote_time)

    write_csv(out / "clubs.csv", clubs)
    write_csv(out / "elections.csv", elections)
    write_csv(out / "election_candidates.csv", candidates)
    write_csv(out / "voters.csv", voters)
    write_csv(out / "voter_trait_options.csv", voter_trait_options)
    write_csv(out / "ballot_submissions.csv", ballot_submissions)
    write_csv(out / "ballot_rankings.csv", ballot_rankings)
    write_csv(out / "ballot_vote.csv", ballot_vote)

    print(f"Generated CSVs in: {out.resolve()}")
    print(f"Unique voters: {len(voters)}")
    print(f"Trait history rows: {len(voter_trait_options)}")
    print(f"Ballot submissions including revotes: {len(ballot_submissions)}")
    print(f"Ballot rankings: {len(ballot_rankings)}")
    print(f"Ballot vote snapshot rows: {len(ballot_vote)}")

if __name__ == "__main__":
    main()