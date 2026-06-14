export function placeAbilityOnSlot(
  slotMap: readonly (string | null)[],
  abilityId: string,
  targetIndex: number,
): (string | null)[] {
  const next = slotMap.slice();
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  const sourceIndex = next.indexOf(abilityId);
  if (sourceIndex === targetIndex) return next;
  if (sourceIndex !== -1) {
    [next[sourceIndex], next[targetIndex]] = [next[targetIndex], next[sourceIndex]];
    return next;
  }
  next[targetIndex] = abilityId;
  return next;
}
