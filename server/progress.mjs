// Only completed, server-scored rooms feed progress; unfinished opponents stay private.
export function completedRooms(db, userId) {
  return db.prepare(`SELECT r.body FROM rooms r JOIN room_members m ON m.code=r.code
    WHERE m.user_id=? AND r.status='completed' ORDER BY r.created_at, r.code`).all(userId)
    .map(row => JSON.parse(row.body));
}

function exerciseKey(q, difficulty) {
  return JSON.stringify([q.kind, difficulty, q.kind === 'math' ? q.prompt
    : q.kind === 'flags' ? q.visual : [q.countryCode, q.capitalRole]]);
}

export function pendingMistakes(rooms, userId) {
  const latest = new Map();
  for (const room of rooms) {
    const player = room.players.find(p => p.id === userId);
    for (const answer of player.answers) {
      const question = player.questions.find(q => q.id === answer.questionId);
      if (!question) continue;
      const key = exerciseKey(question, room.difficulty);
      const previous = latest.get(key);
      if (!previous || answer.receivedAt >= previous.at) latest.set(key, {
        question, difficulty: room.difficulty, correct: answer.correct, at: answer.receivedAt,
      });
    }
  }
  return [...latest.values()].filter(item => !item.correct).sort((a, b) => b.at - a.at);
}

export function progressView(rooms, userId) {
  const groups = new Map();
  for (const room of rooms) {
    const p = room.players.find(player => player.id === userId);
    const difficulty = room.topic === 'chess' && room.mode === 'friends' ? 'human' : room.difficulty;
    const mode = room.trainingQuestions ? 'mistakes' : room.mode;
    const key = `${room.topic}/${difficulty}/${mode}`;
    const group = groups.get(key) ?? { topic: room.topic, difficulty, mode, games: 0,
      wins: 0, draws: 0, losses: 0, correct: 0, wrong: 0, skipped: 0, bestScore: null };
    group.games++;
    if (room.topic === 'puzzles') {
      if (room.reason === 'PUZZLE_SOLVED') group.correct++;
      else group.wrong++;
    }
    const competitive = room.mode === 'friends' || room.topic === 'chess';
    if (competitive) {
      if (room.winners.includes(userId)) {
        if (room.winners.length > 1) group.draws++;
        else group.wins++;
      } else group.losses++;
    }
    for (const a of p.answers) {
      if (a.skipped) group.skipped++;
      else if (a.correct) group.correct++;
      else group.wrong++;
    }
    if (p.status === 'finished') group.bestScore = Math.max(group.bestScore ?? -Infinity, p.score);
    groups.set(key, group);
  }
  const mistakes = pendingMistakes(rooms, userId);
  return { games: rooms.length, groups: [...groups.values()], mistakes: mistakes.length,
    mistakeGroups: ['math', 'flags', 'capitals'].flatMap(topic => ['easy', 'normal', 'hard'].map(difficulty => ({
      topic, difficulty, count: mistakes.filter(m => m.question.kind === topic && m.difficulty === difficulty).length,
    }))).filter(group => group.count) };
}
