---
name: api-design
description: 设计清晰、一致、易用的RESTful API接口，包括路径设计、请求响应格式、错误处理、文档编写
builtin: true
---

# API设计技能

## 描述
设计清晰、一致、易用的RESTful API接口，包括路径设计、请求响应格式、错误处理、文档编写。

## API设计原则

### 1. RESTful规范
- 使用HTTP方法表达操作意图
  - GET: 查询（幂等，无副作用）
  - POST: 创建
  - PUT: 完整更新（幂等）
  - PATCH: 部分更新
  - DELETE: 删除（幂等）
- URL表达资源，不包含动词
  - ✓ GET /users/123
  - ✗ GET /getUser?id=123

### 2. URL路径设计
- 使用复数名词表示资源集合
  - /users, /products, /orders
- 使用层级关系表达从属
  - /users/123/orders
  - /projects/456/tasks/789
- 使用查询参数过滤和分页
  - /users?role=admin&page=2&limit=20
  - /products?category=electronics&sort=-price

### 3. 请求格式
```json
// POST /users - 创建用户
{
  "username": "john_doe",
  "email": "john@example.com",
  "role": "user"
}

// PATCH /users/123 - 部分更新
{
  "email": "newemail@example.com"
}
```

### 4. 响应格式（统一结构）
```json
// 成功响应
{
  "code": 0,
  "message": "success",
  "data": {
    "id": 123,
    "username": "john_doe",
    "email": "john@example.com",
    "createdAt": "2024-01-15T08:30:00Z"
  }
}

// 列表响应（带分页）
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 156,
      "pages": 8
    }
  }
}

// 错误响应
{
  "code": 400,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### 5. HTTP状态码使用
- **2xx 成功**
  - 200 OK: 通用成功
  - 201 Created: 资源创建成功
  - 204 No Content: 成功但无返回内容（DELETE常用）
- **4xx 客户端错误**
  - 400 Bad Request: 请求参数错误
  - 401 Unauthorized: 未认证
  - 403 Forbidden: 无权限
  - 404 Not Found: 资源不存在
  - 409 Conflict: 资源冲突（如重复创建）
  - 422 Unprocessable Entity: 语义错误（如业务规则不通过）
  - 429 Too Many Requests: 请求过于频繁
- **5xx 服务端错误**
  - 500 Internal Server Error: 服务器内部错误
  - 503 Service Unavailable: 服务暂时不可用

### 6. 错误码设计
定义清晰的业务错误码体系：
```
0: 成功
1000-1999: 通用错误（参数错误、权限错误）
2000-2999: 用户相关错误
3000-3999: 订单相关错误
4000-4999: 支付相关错误
...
```

示例：
```json
{
  "code": 2001,
  "message": "用户名已存在",
  "field": "username"
}
```

### 7. 认证与授权
- 使用Bearer Token（JWT）
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```
- Token过期返回401，提示客户端刷新token
- 敏感操作需要二次验证

### 8. 版本控制
- URL路径版本（推荐）
  - /v1/users
  - /v2/users
- 请求头版本
  - Accept: application/vnd.api.v2+json

### 9. 安全考虑
- [ ] 所有接口验证权限
- [ ] 输入参数验证和过滤
- [ ] 防止SQL注入（参数化查询）
- [ ] 防止XSS（输出转义）
- [ ] HTTPS传输敏感数据
- [ ] 敏感字段脱敏（不返回密码、完整手机号等）
- [ ] 频率限制（防刷）
- [ ] CSRF保护

### 10. 性能优化
- [ ] 列表接口必须分页
- [ ] 支持字段筛选（只返回需要的字段）
  - GET /users/123?fields=id,username,email
- [ ] 批量操作接口
  - POST /users/batch-delete
- [ ] 适当的缓存策略
  - Cache-Control, ETag
- [ ] 数据库查询优化（索引、避免N+1）

## API文档模板

```markdown
### 获取用户列表

**接口**: GET /api/v1/users

**权限**: 需要登录

**请求参数**:
| 参数 | 类型 | 必填 | 说明 | 示例 |
|------|------|------|------|------|
| page | integer | 否 | 页码，默认1 | 1 |
| limit | integer | 否 | 每页数量，默认20，最大100 | 20 |
| role | string | 否 | 角色筛选：admin/user | admin |
| keyword | string | 否 | 搜索关键词（用户名/邮箱） | john |

**成功响应** (200):
\`\`\`json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {
        "id": 1,
        "username": "john_doe",
        "email": "john@example.com",
        "role": "admin",
        "createdAt": "2024-01-15T08:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 156,
      "pages": 8
    }
  }
}
\`\`\`

**错误响应**:
- 401: 未登录
- 403: 无权限访问

**示例**:
\`\`\`bash
curl -X GET "https://api.example.com/api/v1/users?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
\`\`\`
```

## 设计检查清单

- [ ] URL符合RESTful规范
- [ ] HTTP方法使用正确
- [ ] 请求响应格式统一
- [ ] 错误码定义清晰
- [ ] 状态码使用恰当
- [ ] 有输入验证
- [ ] 有权限校验
- [ ] 有频率限制
- [ ] 列表接口有分页
- [ ] 敏感数据已脱敏
- [ ] API文档完整

## 使用示例

1. 根据需求分析要设计的资源和操作
2. 设计URL路径和HTTP方法
3. 定义请求参数和响应格式
4. 设计错误码和错误处理
5. 编写API文档
6. 评审安全性和性能
