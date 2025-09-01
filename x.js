fetch("http://localhost:3014/api/settings", {
  "headers": {
    "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczpcL1wvcXVpY2tzdGFydC00ZWY1YWZmZS5teXNob3BpZnkuY29tXC9hZG1pbiIsImRlc3QiOiJodHRwczpcL1wvcXVpY2tzdGFydC00ZWY1YWZmZS5teXNob3BpZnkuY29tIiwiYXVkIjoiOTEzMzk2YjIyOTU4MGZmM2YxNTAxOGU3YjU1ZjdjMjQiLCJzdWIiOiI4NDY5MjIwNTc3NiIsImV4cCI6MTc1NjcwNDA0MiwibmJmIjoxNzU2NzAzOTgyLCJpYXQiOjE3NTY3MDM5ODIsImp0aSI6ImM3OWNlMWMwLWJjNDAtNGQ5MC05OTM1LTRmMDVmMDk3MWI1MCIsInNpZCI6ImRjZGM4ZTllLWJlZDktNDE2My1iMDVmLTNlYmI2NzUzN2M4NSIsInNpZyI6IjhlN2Y5MWIwMzhmMmY0ZjZkN2MwYmYwYTBjMmIwOGI1NTYxY2ZkNzIzYTQxNWNkYmVjZTQ2OTNkOGUxMjdiYTEifQ.6vd7m7LSaXUadTmqAUyD223wCkcz3xfY54fnZEMTOBc",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"99\", \"Google Chrome\";v=\"139\", \"Chromium\";v=\"139\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\""
  },
  "referrer": "https://travels-incidence-array-completed.trycloudflare.com/",
  "body": null,
  "method": "GET",
  "mode": "cors",
  "credentials": "include"
}).then(r => r.json()).then(console.log)