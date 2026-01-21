import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log('='.repeat(60));
console.log('Anthropic API Connectivity Test');
console.log('='.repeat(60));
console.log('API Key:', process.env.ANTHROPIC_API_KEY?.substring(0, 15) + '...');
console.log('');

async function testAPI() {
  try {
    console.log('🔄 Testing API connection...');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say "API test successful"' }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : 'No text';
    console.log('✅ API Test Success!');
    console.log('Response:', text);
    return true;
  } catch (error: any) {
    console.log('❌ API Test Failed!');
    console.log('Error:', error.message);
    if (error.status) console.log('Status:', error.status);
    if (error.type) console.log('Type:', error.type);
    if (error.error) console.log('Error details:', JSON.stringify(error.error, null, 2));
    return false;
  }
}

testAPI().then(success => {
  console.log('');
  console.log('='.repeat(60));
  console.log(success ? '✅ API is available' : '❌ API is not available');
  console.log('='.repeat(60));
  process.exit(success ? 0 : 1);
});
