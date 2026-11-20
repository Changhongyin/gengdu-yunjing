// Ownership of the one <page-container> back catcher.
// The platform allows a single page-container instance. Guide layers exist on every
// cached tab page (custom tab bar) and on every pushed tourism page (companion host),
// so an instance may only mount its catcher while it holds this token, and it must
// unmount it when it closes, hides or loses the token.
let owner = null;
module.exports = {
  // Takes the token for agent. A previous owner is told to unmount first.
  claim(agent) {
    if (owner === agent) return;
    const previous = owner;
    owner = agent;
    if (previous && typeof previous.releaseContainer === 'function') previous.releaseContainer();
  },
  release(agent) { if (owner === agent) owner = null; },
  owner() { return owner; },
  owns(agent) { return owner === agent; }
};
