import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(config => {
  const token = localStorage.getItem('authToken')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('authToken')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login:          (email, password)              => api.post('/auth/login', { email, password }),
  changePassword: (currentPassword, newPassword) => api.put('/auth/change-password', { currentPassword, newPassword }),
}

export const clientsApi = {
  getAll:         ()         => api.get('/outreach/clients'),
  create:         (data)     => api.post('/outreach/clients', data),
  update:         (id, data) => api.put(`/outreach/clients/${id}`, data),
  resetMessages:  (id)       => api.put(`/outreach/clients/${id}`, { messageCount: 0 }),
}

export const usersApi = {
  getAll: () => api.get('/outreach/users'),
}

export const appointmentsApi = {
  getAll: () => api.get('/outreach/appointments'),
}

export const servicesApi = {
  getAll: (clientId) => api.get('/outreach/services', { params: clientId ? { clientId } : {} }),
}

export const employeesApi = {
  getAll: () => api.get('/outreach/employees'),
}

export const kbApi = {
  syncSheets:    (clientId) => api.post('/kb/sync/sheets',     { clientId }),
  syncMicrosoft: (clientId) => api.post('/kb/sync/microsoft',  { clientId }),
  syncConfluence:(clientId) => api.post('/kb/sync/confluence', { clientId }),
}

export const monitoringApi = {
  getHealth: ()       => api.get('/outreach/monitoring/health'),
  getLogs:   (params) => api.get('/outreach/monitoring/logs', { params }),
}

export default api
