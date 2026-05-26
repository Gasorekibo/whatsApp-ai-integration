import axios from 'axios'

const api = axios.create({ baseURL: '/api' })
const publicApi = axios.create({ baseURL: '/api' })

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
      window.location.href = '/ai/admin/login'
    }
    return Promise.reject(err)
  }
)

export const authApi = {
  login:          (email, password)              => publicApi.post('/auth/login', { email, password }),
  changePassword: (currentPassword, newPassword) => api.put('/auth/change-password', { currentPassword, newPassword }),
}

export const clientsApi = {
  getAll:            ()         => api.get('/outreach/clients'),
  create:            (data)     => api.post('/outreach/clients', data),
  update:            (id, data) => api.put(`/outreach/clients/${id}`, data),
  resetMessages:     (id)       => api.put(`/outreach/clients/${id}`, { messageCount: 0 }),
  generateFormToken: (id)       => api.post(`/outreach/clients/${id}/form-token`),
}

export const usersApi = {
  getAll: () => api.get('/outreach/users'),
}

export const appointmentsApi = {
  getAll: () => api.get('/outreach/appointments'),
}

export const servicesApi = {
  getAll: () => api.get('/outreach/services'),
}

export const employeesApi = {
  getAll: () => api.get('/outreach/employees'),
}

export const kbApi = {
  syncSheets:    () => api.post('/kb/sync/sheets'),
  syncMicrosoft: () => api.post('/kb/sync/microsoft'),
  syncConfluence:() => api.post('/kb/sync/confluence'),
}

export const generalInfoApi = {
  get:    () => api.get('/outreach/general-info'),
  update: (data) => api.put('/outreach/general-info', data),
}

export const onboardingApi = {
  get:    (token)        => publicApi.get(`/onboarding/${token}`),
  submit: (token, data)  => publicApi.post(`/onboarding/${token}`, data),
}

export const monitoringApi = {
  getHealth: ()       => api.get('/outreach/monitoring/health'),
  getLogs:   (params) => api.get('/outreach/monitoring/logs', { params }),
}

export default api
