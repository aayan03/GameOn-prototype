// Shared by seed.js and autoSeed.js so both boot with a lived-in TeamUp feed
// instead of an empty one. Needs the already-created player and venue docs,
// since posts and teams reference their real ids.

function inDays(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function byName(venueDocs, name) {
  return venueDocs.find((v) => v.name === name);
}

/** [{ name, sport, city, skillLevel, captainIndex, memberIndexes }] → Team.create() input */
export function demoTeams(playerDocs) {
  return [
    {
      name: 'Koramangala Strikers',
      sport: 'football',
      city: 'Bengaluru',
      skillLevel: 'advanced',
      captain: playerDocs[0]._id,
      members: [
        { user: playerDocs[0]._id, role: 'captain' },
        { user: playerDocs[1]._id, role: 'player' },
      ],
    },
  ];
}

/** playerDocs order matches seed/data.js `players`: [aayan, adeem, veer, vaishnavi, anushka] */
export function demoTeamUpPosts(playerDocs, venueDocs) {
  const [aayan, adeem, veer, , anushka] = playerDocs;
  const turfNation = byName(venueDocs, 'Turf Nation Koramangala');
  const andheriArena = byName(venueDocs, 'Andheri Sports Arena');
  const saketHoops = byName(venueDocs, 'Saket Hoops Centre');

  return [
    {
      host: aayan._id, type: 'need_players', sport: 'football',
      title: 'Need 4 for 7-a-side Friday night',
      description: 'Regular Friday game, friendly but competitive. Bring your own boots.',
      venue: turfNation?._id, location: turfNation?.location,
      proposedArea: 'Koramangala, Bengaluru',
      playAt: inDays(2, 19), durationMins: 60,
      spotsNeeded: 4, skillLevel: 'intermediate',
      costSharing: { enabled: true, totalAmount: 1800, perPersonAmount: 450 },
      autoApprove: true,
    },
    {
      host: adeem._id, type: 'looking_to_join', sport: 'badminton',
      title: 'Looking for a doubles partner, Sarjapur',
      description: 'Intermediate level, free most evenings this week.',
      proposedArea: 'Sarjapur, Bengaluru',
      location: { type: 'Point', coordinates: [77.6874, 12.9010] },
      playAt: inDays(1, 19), durationMins: 60,
      spotsNeeded: 1, skillLevel: 'intermediate',
      costSharing: { enabled: false, totalAmount: 0, perPersonAmount: 0 },
    },
    {
      host: veer._id, type: 'need_opponent', sport: 'football',
      title: 'Full 5-a-side squad looking for opponents',
      description: 'We have 5, want a proper match, not just a kickabout.',
      venue: andheriArena?._id, location: andheriArena?.location,
      proposedArea: 'Andheri, Mumbai',
      playAt: inDays(3, 20), durationMins: 60,
      spotsNeeded: 5, skillLevel: 'any',
      costSharing: { enabled: false, totalAmount: 0, perPersonAmount: 0 },
    },
    {
      host: anushka._id, type: 'need_players', sport: 'basketball',
      title: '3-on-3 run, need 2 more',
      description: 'Casual pickup game, all skill levels welcome.',
      venue: saketHoops?._id, location: saketHoops?.location,
      proposedArea: 'Saket, Delhi',
      playAt: inDays(1, 18), durationMins: 45,
      spotsNeeded: 2, skillLevel: 'any',
      costSharing: { enabled: true, totalAmount: 500, perPersonAmount: 250 },
    },
  ];
}
