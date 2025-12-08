import { Context } from '../../bot/context.js';
export declare function showPaymentMethods(ctx: Context): Promise<void>;
export declare function createPayment(ctx: Context, amount: number, orderId: string): Promise<void>;
export declare function createBalanceTopUp(ctx: Context, amount: number): Promise<void>;
export declare function checkPaymentStatus(ctx: Context, paymentId: string): Promise<void>;
export declare function cancelPayment(ctx: Context, paymentId: string): Promise<void>;
