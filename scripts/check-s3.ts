import { S3Client, ListBucketsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

async function checkS3() {
  console.log('=== AWS S3 Configuration Check ===\n');

  console.log('Configuration:');
  console.log('  Region:', process.env.AWS_REGION);
  console.log('  Access Key ID:', process.env.AWS_ACCESS_KEY_ID?.substring(0, 10) + '...');
  console.log('  Bucket:', process.env.S3_BUCKET);
  console.log('');

  try {
    // 1. Credentials 유효성 체크 (버킷 목록 가져오기)
    console.log('Step 1: Checking AWS credentials...');
    const listCommand = new ListBucketsCommand({});
    const listResponse = await s3Client.send(listCommand);

    console.log('  ✓ AWS credentials are valid!');
    console.log('  Found', listResponse.Buckets?.length || 0, 'buckets in your account');
    console.log('');

    // 2. 버킷 존재 여부 체크
    console.log('Step 2: Checking if bucket exists...');
    const bucketName = process.env.S3_BUCKET;

    if (!bucketName) {
      console.log('  ✗ S3_BUCKET environment variable is not set!');
      return;
    }

    const headCommand = new HeadBucketCommand({ Bucket: bucketName });
    await s3Client.send(headCommand);

    console.log(`  ✓ Bucket "${bucketName}" exists and is accessible!`);
    console.log('');

    // 3. 권한 체크 (객체 업로드 가능한지)
    console.log('Step 3: Checking permissions...');
    console.log('  Note: Make sure your AWS credentials have s3:PutObject permission');
    console.log('');

    console.log('=== All checks passed! ✓ ===');
    console.log('\nYour S3 configuration is correct. File upload should work.');

  } catch (error: any) {
    console.error('✗ Error occurred:');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.Code || 'N/A');

    if (error.name === 'NoSuchBucket') {
      console.error('\n  Solution: Bucket does not exist. Create it in AWS S3 console.');
    } else if (error.name === 'InvalidAccessKeyId') {
      console.error('\n  Solution: AWS_ACCESS_KEY_ID is invalid. Check your .env file.');
    } else if (error.name === 'SignatureDoesNotMatch') {
      console.error('\n  Solution: AWS_SECRET_ACCESS_KEY is invalid. Check your .env file.');
    } else if (error.Code === 'AccessDenied') {
      console.error('\n  Solution: Your AWS credentials don\'t have permission to access this bucket.');
    }
  }
}

checkS3();
