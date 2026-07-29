export function calculatePOEta(orderedAt: Date, leadTimes: Array<number | null | undefined>): Date | null {
    const validLeadTimes = leadTimes.filter(
        (leadTime): leadTime is number => leadTime != null && Number.isFinite(leadTime) && leadTime >= 0,
    );
    if (validLeadTimes.length === 0) return null;

    const eta = new Date(orderedAt);
    eta.setUTCDate(eta.getUTCDate() + Math.max(...validLeadTimes));
    return eta;
}
