function dateParts(): { y: number; m: string; d: string } {
    const now = new Date();
    return {
        y: now.getFullYear(),
        m: String(now.getMonth() + 1).padStart(2, "0"),
        d: String(now.getDate()).padStart(2, "0"),
    };
}

function rand4(): number {
    return Math.floor(Math.random() * 9000) + 1000;
}

export function generateRFQNumber(): string {
    const { y, m, d } = dateParts();
    return `RFQ-${y}${m}${d}-${rand4()}`;
}

export function generatePONumber(): string {
    const { y, m, d } = dateParts();
    return `PO-${y}${m}${d}-${rand4()}`;
}

export function generateReceiptNumber(): string {
    const { y, m, d } = dateParts();
    return `RCV-RM-${y}${m}${d}-${rand4()}`;
}

export function generateReturnNumber(): string {
    const { y, m, d } = dateParts();
    return `RTN-${y}${m}${d}-${rand4()}`;
}

export function generateAPNumber(): string {
    const { y, m, d } = dateParts();
    return `AP-${y}${m}${d}-${rand4()}`;
}
