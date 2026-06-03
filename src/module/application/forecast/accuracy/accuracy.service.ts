export class ForecastAccuracyService {
    static formatAccuracy(forecast: number, sales: number): string {
        if (sales <= 0) return "N/A";
        const accuracy = (1 - Math.abs(forecast - sales) / sales) * 100;
        const clamped = Math.max(0, accuracy);
        return `${clamped.toFixed(2)}%`;
    }
}
