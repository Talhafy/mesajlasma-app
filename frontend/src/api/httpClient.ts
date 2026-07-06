import axios from 'axios';
import { API_BASE_URL } from '../config/runtime';

// Uygulama API çağrıları interceptor'larla access token alır.
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

// Refresh istemcisi ayrı tutulur; 401 interceptor'ının kendisini çağırıp döngüye girmesini önler.
export const authApi = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});
