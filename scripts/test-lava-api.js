import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const projectId = process.env.LAVA_PROJECT_ID;
const secretKey = process.env.LAVA_SECRET_KEY;
const baseUrl = process.env.LAVA_BASE_URL || 'https://api.lava.top';

console.log('🔍 Testing Lava API Configuration:');
console.log('Project ID:', projectId);
console.log('Secret Key length:', secretKey?.length);
console.log('Base URL:', baseUrl);

function createSignature(data, key) {
  return crypto
    .createHmac('sha256', key)
    .update(data)
    .digest('hex');
}

async function testEndpoint(endpoint) {
  const timestamp = Math.floor(Date.now() / 1000);
  const requestData = {
    sum: 100,
    orderId: `TEST-${Date.now()}`,
    hookUrl: 'https://plazma-production.up.railway.app/webhook/lava',
    comment: 'Test invoice'
  };
  
  const dataString = JSON.stringify(requestData);
  const signature = createSignature(dataString, secretKey);
  
  const url = `${baseUrl}${endpoint}`;
  
  console.log(`\n🧪 Testing endpoint: ${url}`);
  console.log('Request data:', requestData);
  console.log('Signature (first 20 chars):', signature.substring(0, 20) + '...');
  
  try {
    const response = await axios.post(url, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${secretKey}`,
        'X-Project-Id': projectId,
        'X-Signature': signature,
        'X-Timestamp': timestamp.toString()
      }
    });
    
    console.log('✅ Success! Status:', response.status);
    console.log('Response:', response.data);
    return true;
  } catch (error) {
    console.log('❌ Error:', error.response?.status, error.response?.statusText);
    console.log('Response data:', error.response?.data);
    return false;
  }
}

async function main() {
  const endpoints = [
    '/invoice/create',
    '/api/invoice/create',
    '/api/v2/invoice/create',
    '/api/v1/invoice/create'
  ];
  
  for (const endpoint of endpoints) {
    const success = await testEndpoint(endpoint);
    if (success) {
      console.log(`\n✅ Working endpoint found: ${endpoint}`);
      break;
    }
    // Wait a bit between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(console.error);



