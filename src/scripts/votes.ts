/**
 * Client-side voting store backed by localStorage.
 *
 * Votes are persisted per-browser. The server-side votes.json provides the
 * community seed counts displayed on initial render; localStorage tracks
 * the current user's votes and any local increments on top of the seed.
 *
 * Future upgrade path: swap loadSeedVotes() to fetch('/api/votes') and
 * castVote() to POST '/api/vote?pattern=X&direction=up' once the site
 * moves to a server-enabled deployment.
 */

export type VoteDirection = 'up' | 'down';

export interface PatternVotes {
  up: number;
  down: number;
}

export interface VoteStore {
  [patternId: string]: PatternVotes;
}

const STORAGE_KEY = 'app_votes';
const USER_VOTES_KEY = 'app_user_votes';

/** Merge seed votes (from build-time JSON) with any locally stored increments */
export function mergeWithLocalVotes(seed: VoteStore): VoteStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed;
    const local: VoteStore = JSON.parse(raw);
    const merged: VoteStore = { ...seed };
    for (const [id, counts] of Object.entries(local)) {
      merged[id] = {
        up: (merged[id]?.up ?? 0) + (counts.up ?? 0),
        down: (merged[id]?.down ?? 0) + (counts.down ?? 0),
      };
    }
    return merged;
  } catch {
    return seed;
  }
}

/** Return the vote direction the current user has cast for a pattern, or null */
export function getUserVote(patternId: string): VoteDirection | null {
  try {
    const raw = localStorage.getItem(USER_VOTES_KEY);
    if (!raw) return null;
    const uv: Record<string, VoteDirection> = JSON.parse(raw);
    return uv[patternId] ?? null;
  } catch {
    return null;
  }
}

/**
 * Cast or toggle a vote. Returns the new net counts for the pattern.
 *
 * Rules:
 * - Voting the same direction twice clears the vote.
 * - Switching direction removes the old vote and adds the new one.
 */
export function castVote(
  patternId: string,
  direction: VoteDirection,
  seedVotes: PatternVotes,
): { votes: PatternVotes; userVote: VoteDirection | null } {
  const existing = getUserVote(patternId);
  let localDelta: PatternVotes = getLocalDelta(patternId);
  let newUserVote: VoteDirection | null;

  if (existing === direction) {
    // Toggle off
    localDelta[direction] = Math.max(0, localDelta[direction] - 1);
    newUserVote = null;
  } else {
    if (existing) {
      // Remove old vote
      localDelta[existing] = Math.max(0, localDelta[existing] - 1);
    }
    localDelta[direction] = (localDelta[direction] ?? 0) + 1;
    newUserVote = direction;
  }

  saveLocalDelta(patternId, localDelta);
  saveUserVote(patternId, newUserVote);

  const votes: PatternVotes = {
    up: seedVotes.up + localDelta.up,
    down: seedVotes.down + localDelta.down,
  };

  return { votes, userVote: newUserVote };
}

function getLocalDelta(patternId: string): PatternVotes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: VoteStore = raw ? JSON.parse(raw) : {};
    return store[patternId] ?? { up: 0, down: 0 };
  } catch {
    return { up: 0, down: 0 };
  }
}

function saveLocalDelta(patternId: string, delta: PatternVotes): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: VoteStore = raw ? JSON.parse(raw) : {};
    store[patternId] = delta;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable (private browsing, etc.) — degrade gracefully
  }
}

function saveUserVote(patternId: string, direction: VoteDirection | null): void {
  try {
    const raw = localStorage.getItem(USER_VOTES_KEY);
    const uv: Record<string, VoteDirection> = raw ? JSON.parse(raw) : {};
    if (direction === null) {
      delete uv[patternId];
    } else {
      uv[patternId] = direction;
    }
    localStorage.setItem(USER_VOTES_KEY, JSON.stringify(uv));
  } catch {
    // degrade gracefully
  }
}
