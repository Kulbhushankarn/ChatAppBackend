// Simple test script to check if the backend server is accessible
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const API_URL = 'https://chatappbackend-84ur.onrender.com';

async function testServer() {
  console.log('Testing backend server connection...');
  console.log('API URL:', API_URL);
  console.log('Environment variables:');
  console.log('- PORT:', process.env.PORT);
  console.log('- JWT_SECRET:', process.env.JWT_SECRET ? 'Set (hidden)' : 'Not set');
  console.log('- CORS_ORIGIN:', process.env.CORS_ORIGIN);
  console.log('- MONGODB_URI:', process.env.MONGODB_URI ? 'Set (hidden)' : 'Not set');
  
  try {
    // Test basic connectivity
    console.log('\nTesting basic connectivity...');
    const response = await axios.get(`${API_URL}/api/users/online`);
    console.log('Server is accessible!');
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    
    // Test login endpoint
    console.log('\nTesting login endpoint...');
    try {
      const loginResponse = await axios.post(`${API_URL}/api/auth/login`, {
        email: 'test@example.com',
        password: 'wrongpassword'
      });
      console.log('Login response status:', loginResponse.status);
      console.log('Login response data:', loginResponse.data);
    } catch (loginError) {
      console.log('Expected login error (with wrong credentials):', loginError.response ? loginError.response.status : loginError.message);
      if (loginError.response) {
        console.log('Login error data:', loginError.response.data);
      }
    }
    
  } catch (error) {
    console.error('Error connecting to server:');
    if (error.response) {
      // The server responded with a status code outside the 2xx range
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server');
    } else {
      // Something happened in setting up the request
      console.error('Error setting up request:', error.message);
    }
  }
}

testServer();