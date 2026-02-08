import QRCode from 'qrcode';
import { uploadImage } from './cloudinary-service.js';

/**
 * Generate QR code as Buffer
 */
export async function generateQRCode(text: string): Promise<Buffer> {
    try {
        // Generate QR code as Data URL
        const dataUrl = await QRCode.toDataURL(text, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            margin: 1,
            width: 500,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
        });

        // Convert Data URL to Buffer
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        return Buffer.from(base64Data, 'base64');
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
