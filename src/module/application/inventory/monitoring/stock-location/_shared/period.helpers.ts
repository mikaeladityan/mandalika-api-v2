export function resolvePeriod(month?: number, year?: number): { month: number; year: number } {
    const now = new Date();
    return {
        month: month ?? now.getMonth() + 1,
        year:  year  ?? now.getFullYear(),
    };
}
