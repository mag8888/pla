import QRCode from 'qrcode';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { uploadImage } from './cloudinary-service.js';

/**
 * Generate QR code as Buffer with Logo
 */
export async function generateQRCode(text: string): Promise<Buffer> {
    try {
        // Generate QR code as Buffer
        const qrBuffer = await QRCode.toBuffer(text, {
            errorCorrectionLevel: 'H', // High error correction to support logo overlay
            type: 'png',
            margin: 1,
            width: 500,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
        });

        // Path to logo - trying to find logo_new.png
        const logoPath = path.resolve(process.cwd(), 'webapp/static/logo_new.png');

        if (fs.existsSync(logoPath)) {
            try {
                // Resize logo to fit in the center (approx 20% of QR size)
                const logo = await sharp(logoPath)
                    .resize(100, 100, {
                        fit: 'contain',
                        background: { r: 255, g: 255, b: 255, alpha: 0 }
                    })
                    .toBuffer();

                // Composite logo onto QR code
                const compositeBuffer = await sharp(qrBuffer)
                    .composite([{ input: logo, gravity: 'center' }])
                    .toBuffer();

                return compositeBuffer;
            } catch (imgError) {
                console.warn('⚠️ Failed to add logo to QR code:', imgError);
                return qrBuffer; // Fallback to QR without logo
            }
        } else {
            console.warn(`⚠️ QR Logo file not found at: ${logoPath}`);
            return qrBuffer;
        }
    } catch (error) {
        console.error('Error generating QR code:', error);
        throw new Error('Failed to generate QR code');
    }
}

/**
 * Generate QR code and upload to Cloudinary
 * Returns the secure URL of the uploaded image
 */
export async function generateAndUploadQRCode(
    text: string,
    folder: string = 'vital/qr-codes',
    filename: string
): Promise<string> {
    try {
        const buffer = await generateQRCode(text);

        // Upload to Cloudinary
        const result = await uploadImage(buffer, {
            folder,
            publicId: filename,
            resourceType: 'image',
            format: 'png',
        });

        return result.secureUrl;
    } catch (error) {
        console.error('Error generating and uploading QR code:', error);
        throw error;
    }
}
