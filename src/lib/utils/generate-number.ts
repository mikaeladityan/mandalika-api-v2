interface CountableModel {
    count(args: { where: Record<string, { startsWith: string }> }): Promise<number>;
}

export interface DocNumberClient {
    purchaseRFQ: CountableModel;
    purchaseOrder: CountableModel;
    purchaseReceipt: CountableModel;
    vendorReturn: CountableModel;
    accountPayable: CountableModel;
}

function getDateStr(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

async function nextSeq(model: CountableModel, field: string, prefix: string): Promise<string> {
    const count = await model.count({ where: { [field]: { startsWith: prefix } } });
    return String(count + 1).padStart(3, "0");
}

export async function generateRFQNumber(db: DocNumberClient): Promise<string> {
    const prefix = `RFQ-${getDateStr()}-`;
    return `${prefix}${await nextSeq(db.purchaseRFQ, "rfq_number", prefix)}`;
}

export async function generatePONumber(db: DocNumberClient): Promise<string> {
    const prefix = `PO-${getDateStr()}-`;
    return `${prefix}${await nextSeq(db.purchaseOrder, "po_number", prefix)}`;
}

export async function generateReceiptNumber(db: DocNumberClient): Promise<string> {
    const prefix = `RCV-RM-${getDateStr()}-`;
    return `${prefix}${await nextSeq(db.purchaseReceipt, "receipt_number", prefix)}`;
}

export async function generateReturnNumber(db: DocNumberClient): Promise<string> {
    const prefix = `RTN-${getDateStr()}-`;
    return `${prefix}${await nextSeq(db.vendorReturn, "return_number", prefix)}`;
}

export async function generateAPNumber(db: DocNumberClient): Promise<string> {
    const prefix = `AP-${getDateStr()}-`;
    return `${prefix}${await nextSeq(db.accountPayable, "ap_number", prefix)}`;
}
