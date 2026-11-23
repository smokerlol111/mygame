function checkpoints(total) {
  return [...new Set([Math.ceil(total / 3), Math.ceil(2 * total / 3)])].filter(value => value < total);
}

function standings(room) {
  const sorted = [...room.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'));
  let place = 0;
  return sorted.map((team, index) => {
    if (!index || sorted[index - 1].score !== team.score) place = index + 1;
    return { id: team.id, name: team.name, score: team.score, place };
  });
}

function finalGroups(room) {
  const groups = [];
  for (const team of standings(room)) {
    if (groups.at(-1)?.[0].place === team.place) groups.at(-1).push(team);
    else groups.push([team]);
  }
  return groups.reverse();
}

module.exports = { checkpoints, standings, finalGroups };
