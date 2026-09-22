from rest_framework.test import APIClient
from users.models import User
c = APIClient()
u = User.objects.create_user(username="dbg_user", email="dbg@test.local", password="pass12345", role="OPERATIONS")
res = c.post("/api/auth/login/", {"username": "dbg_user", "password": "pass12345"})
c.credentials(HTTP_AUTHORIZATION=f"Token {res.data['token']}")
p = c.post("/api/parties/", {"type": "customer", "client_category": "b2c", "full_name": "Debug Cust", "phone": "0100"})
print("party code:", p.data["code"])
r = c.get(f"/api/parties/search_codes/?search={p.data['code'][:10]}")
print("status:", r.status_code)
print("data:", r.data)
