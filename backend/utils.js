// utils.js

const crypto = require('crypto');

// ─── Fisher-Yates shuffle (unbiased random permutation) ──────────────────────
function fisherYatesShuffle(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ─── R2: Hash voter ID for anonymity ─────────────────────────────────────────
// SHA-256 hash of email - irreversible, consistent per voter
function hashVoterId(email) {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim() + (process.env.VOTER_HASH_SALT || 'monashvote_salt'))
    .digest('hex')
    .slice(0, 16); // 16 hex chars (enough to be unique, short enough to display)
}

// ─── Verification code ────────────────────────────────────────────────────────
function generateVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

// ─── Email sender ─────────────────────────────────────────────────────────────
async function sendVerificationEmail(email, code) {
  // Dev mode: print to console + devCode returned to frontend
  if (process.env.DEV_MODE === 'true') {
    console.log(`\n[DEV EMAIL] To: ${email} | Code: ${code}\n`);
    return;
  }

  // Try Supabase Edge Function first (secrets stored in Supabase, not .env)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-verification-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}` },
        body: JSON.stringify({ email, code })
      });
      if (res.ok) return;
      const err = await res.json();
      console.error('[EMAIL] Edge Function error:', err);
    } catch (e) {
      console.error('[EMAIL] Edge Function failed:', e.message);
    }
  }

  // Fallback: direct nodemailer (needs EMAIL_USER/EMAIL_PASS in .env)
  if (!process.env.EMAIL_USER) {
    console.log(`\n[EMAIL DEBUG] To: ${email} | Code: ${code} (no email service)\n`);
    return;
  }

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT || '587'),
      secure: false, auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });
    await transporter.sendMail({
      from: `"MonashVote" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: email, subject: 'Your MonashVote verification code',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
        <h2 style="color:#002a5c;">MonashVote</h2>
        <p>Your verification code is:</p>
        <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#006dae;margin:24px 0;">${code}</div>
        <p style="color:#666;">This code expires in 10 minutes.</p></div>`
    });
  } catch (err) {
    console.error('[EMAIL] Nodemailer failed:', err.message);
    console.log(`\n[EMAIL FALLBACK] To: ${email} | Code: ${code}\n`);
  }
}

// ─── R7: IRV (Instant Runoff Voting) tally algorithm ─────────────────────────
// ballots: [{ rankings: [{ candidateId, rank }] }]
// candidates: [{ id, name }]
function runIRV(ballots, candidates) {
  const rounds = [];
  let remaining = candidates.map(c => c.id);
  let activeBallots = ballots.map(b => ({
    rankings: [...b.rankings].sort((a, z) => a.rank - z.rank)
  }));

  while (remaining.length > 1) {
    // Count first preferences among remaining candidates
    const tally = {};
    remaining.forEach(id => (tally[id] = 0));

    for (const ballot of activeBallots) {
      const topChoice = ballot.rankings.find(r => remaining.includes(r.candidateId));
      if (topChoice) tally[topChoice.candidateId]++;
    }

    const totalVotes = Object.values(tally).reduce((a, b) => a + b, 0);
    const roundResult = Object.entries(tally).map(([id, votes]) => ({
      candidateId: parseInt(id),
      candidateName: candidates.find(c => c.id === parseInt(id))?.name,
      votes,
      percentage: totalVotes ? ((votes / totalVotes) * 100).toFixed(1) : '0.0'
    })).sort((a, b) => b.votes - a.votes);

    rounds.push({ roundResult, totalVotes });

    // Check for majority
    const leader = roundResult[0];
    if (leader.votes / totalVotes > 0.5) {
      return {
        winner: { candidateId: leader.candidateId, candidateName: leader.candidateName, votes: leader.votes },
        rounds,
        finalTally: roundResult
      };
    }

    // Eliminate candidate with fewest votes
    const eliminated = roundResult[roundResult.length - 1];
    remaining = remaining.filter(id => id !== eliminated.candidateId);
  }

  // Only one remains
  const winnerId = remaining[0];
  return {
    winner: { candidateId: winnerId, candidateName: candidates.find(c => c.id === winnerId)?.name },
    rounds,
    finalTally: [{ candidateId: winnerId, candidateName: candidates.find(c => c.id === winnerId)?.name }]
  };
}

module.exports = { hashVoterId, generateVerificationCode, sendVerificationEmail, runIRV, fisherYatesShuffle };
