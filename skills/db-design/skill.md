---
name: db-design
description: 设计高效、可扩展的数据库结构，包括表设计、关系建模、索引优化、查询性能优化
builtin: true
---

# 数据库设计技能

## 描述
设计高效、可扩展的数据库结构，包括表设计、关系建模、索引优化、查询性能优化。

## 数据库设计原则

### 1. 三范式 (Normalization)
**第一范式 (1NF)**: 字段原子性，不可再分
```sql
-- ❌ 违反1NF：地址字段包含多个信息
CREATE TABLE users (
  id INT,
  address VARCHAR(255)  -- "北京市朝阳区xx街道xx号"
);

-- ✅ 符合1NF：拆分为原子字段
CREATE TABLE users (
  id INT,
  province VARCHAR(50),
  city VARCHAR(50),
  district VARCHAR(50),
  street VARCHAR(100),
  building VARCHAR(50)
);
```

**第二范式 (2NF)**: 非主键字段完全依赖主键
```sql
-- ❌ 违反2NF：部分依赖
CREATE TABLE order_items (
  order_id INT,
  product_id INT,
  product_name VARCHAR(100),  -- 依赖product_id，不依赖order_id
  product_price DECIMAL(10,2), -- 依赖product_id，不依赖order_id
  quantity INT,
  PRIMARY KEY (order_id, product_id)
);

-- ✅ 符合2NF：拆表
CREATE TABLE order_items (
  order_id INT,
  product_id INT,
  quantity INT,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE products (
  product_id INT PRIMARY KEY,
  product_name VARCHAR(100),
  product_price DECIMAL(10,2)
);
```

**第三范式 (3NF)**: 非主键字段不依赖其他非主键字段
```sql
-- ❌ 违反3NF：传递依赖
CREATE TABLE employees (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  department_id INT,
  department_name VARCHAR(100),  -- 依赖department_id
  department_location VARCHAR(100) -- 依赖department_id
);

-- ✅ 符合3NF：拆表
CREATE TABLE employees (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  department_id INT
);

CREATE TABLE departments (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  location VARCHAR(100)
);
```

### 2. 反范式化 (Denormalization)
在某些场景下为了性能可以适当反范式化：
```sql
-- 订单表冗余用户名，避免频繁JOIN
CREATE TABLE orders (
  id INT PRIMARY KEY,
  user_id INT,
  user_name VARCHAR(100),  -- 冗余字段，避免JOIN users表
  total DECIMAL(10,2),
  created_at TIMESTAMP
);

-- 适用场景：
-- 1. 读多写少
-- 2. 数据相对稳定（用户名不常改）
-- 3. 性能瓶颈在JOIN
```

## 表设计规范

### 1. 命名规范
- 表名：复数名词，小写下划线分隔 (`users`, `order_items`)
- 字段名：小写下划线分隔 (`user_id`, `created_at`)
- 主键：统一用 `id`
- 外键：`关联表名_id` (`user_id`, `product_id`)
- 布尔字段：`is_` 或 `has_` 开头 (`is_active`, `has_paid`)
- 时间字段：`_at` 结尾 (`created_at`, `updated_at`, `deleted_at`)

### 2. 字段类型选择
```sql
-- 主键
id BIGINT AUTO_INCREMENT PRIMARY KEY  -- 大表用BIGINT，预留空间

-- 字符串
username VARCHAR(50)          -- 固定长度用VARCHAR
description TEXT              -- 长文本用TEXT
email VARCHAR(255)            -- 邮箱通常不超过255

-- 数字
age TINYINT UNSIGNED         -- 0-255，省空间
price DECIMAL(10,2)          -- 金额用DECIMAL，不用FLOAT
quantity INT                 -- 普通整数用INT

-- 布尔
is_active BOOLEAN            -- 或 TINYINT(1)

-- 时间
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP

-- 枚举
status ENUM('pending', 'processing', 'completed', 'cancelled')
-- 或用VARCHAR + CHECK约束（更灵活）
status VARCHAR(20) CHECK (status IN ('pending', 'processing', 'completed', 'cancelled'))

-- JSON（MySQL 5.7+）
metadata JSON  -- 存储非结构化数据
```

### 3. 必备字段
```sql
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  
  -- 业务字段
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  
  -- 审计字段（必备）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- 软删除（推荐）
  deleted_at TIMESTAMP NULL,
  
  -- 索引
  INDEX idx_email (email),
  INDEX idx_deleted (deleted_at)
);
```

## 关系设计

### 1. 一对多 (One-to-Many)
```sql
-- 一个用户有多个订单
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  username VARCHAR(50)
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  total DECIMAL(10,2),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 2. 多对多 (Many-to-Many)
```sql
-- 学生和课程：多对多关系
CREATE TABLE students (
  id BIGINT PRIMARY KEY,
  name VARCHAR(100)
);

CREATE TABLE courses (
  id BIGINT PRIMARY KEY,
  title VARCHAR(200)
);

-- 中间表
CREATE TABLE student_courses (
  student_id BIGINT,
  course_id BIGINT,
  enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  grade DECIMAL(5,2),
  PRIMARY KEY (student_id, course_id),
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);
```

### 3. 一对一 (One-to-One)
```sql
-- 用户和用户详情（拆表优化查询）
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  username VARCHAR(50),
  email VARCHAR(255)
);

CREATE TABLE user_profiles (
  user_id BIGINT PRIMARY KEY,
  avatar VARCHAR(255),
  bio TEXT,
  birthday DATE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

## 索引设计

### 1. 索引类型
```sql
-- 普通索引
CREATE INDEX idx_email ON users(email);

-- 唯一索引
CREATE UNIQUE INDEX idx_username ON users(username);

-- 复合索引（最左前缀原则）
CREATE INDEX idx_user_status ON orders(user_id, status, created_at);
-- 可以用于：
-- WHERE user_id = ? 
-- WHERE user_id = ? AND status = ?
-- WHERE user_id = ? AND status = ? AND created_at > ?
-- 不能用于：WHERE status = ? （没有user_id）

-- 全文索引
CREATE FULLTEXT INDEX idx_content ON articles(title, content);
```

### 2. 索引使用原则
- WHERE、JOIN、ORDER BY 的字段加索引
- 区分度高的字段加索引（性别不适合，邮箱适合）
- 频繁查询的字段加索引
- 更新频繁的字段慎加索引
- 小表（<1000行）不需要索引
- 复合索引把区分度高的字段放前面

### 3. 索引优化
```sql
-- ❌ 索引失效：对索引字段使用函数
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- ✅ 改写查询
SELECT * FROM users WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';

-- ❌ 索引失效：使用 != 或 <>
SELECT * FROM users WHERE status != 'deleted';

-- ✅ 改用 IN
SELECT * FROM users WHERE status IN ('active', 'pending', 'suspended');

-- ❌ 索引失效：LIKE 以通配符开头
SELECT * FROM users WHERE username LIKE '%john%';

-- ✅ 如果可能，避免左模糊
SELECT * FROM users WHERE username LIKE 'john%';
```

## 查询优化

### 1. 避免 SELECT *
```sql
-- ❌ 查询所有字段
SELECT * FROM users WHERE id = 1;

-- ✅ 只查询需要的字段
SELECT id, username, email FROM users WHERE id = 1;
```

### 2. 避免 N+1 查询
```sql
-- ❌ N+1问题：先查用户，再循环查订单
SELECT * FROM users;
-- 然后对每个用户执行：
SELECT * FROM orders WHERE user_id = ?;

-- ✅ 用JOIN一次查出
SELECT 
  u.id, u.username,
  o.id AS order_id, o.total
FROM users u
LEFT JOIN orders o ON u.id = o.user_id;

-- 或分两次查（如果数据量大）
SELECT * FROM users WHERE id IN (1,2,3,4,5);
SELECT * FROM orders WHERE user_id IN (1,2,3,4,5);
```

### 3. 分页优化
```sql
-- ❌ 深分页性能差
SELECT * FROM orders ORDER BY id LIMIT 100000, 20;

-- ✅ 使用上次查询的最后ID
SELECT * FROM orders WHERE id > 100020 ORDER BY id LIMIT 20;

-- ✅ 或使用延迟关联
SELECT o.* FROM orders o
INNER JOIN (
  SELECT id FROM orders ORDER BY id LIMIT 100000, 20
) AS t ON o.id = t.id;
```

### 4. COUNT 优化
```sql
-- ❌ COUNT(*) 慢（大表）
SELECT COUNT(*) FROM orders;

-- ✅ 近似值（业务允许的话）
SELECT table_rows FROM information_schema.tables 
WHERE table_name = 'orders';

-- ✅ 或缓存计数
CREATE TABLE counters (
  name VARCHAR(50) PRIMARY KEY,
  count BIGINT DEFAULT 0
);
-- 插入/删除订单时更新计数器
```

## 常见场景设计

### 1. 用户系统
```sql
CREATE TABLE users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar VARCHAR(255),
  role ENUM('user', 'admin') DEFAULT 'user',
  status ENUM('active', 'suspended', 'deleted') DEFAULT 'active',
  email_verified BOOLEAN DEFAULT FALSE,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_username (username),
  INDEX idx_status (status)
);
```

### 2. 订单系统
```sql
CREATE TABLE orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(50) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('pending', 'paid', 'shipped', 'completed', 'cancelled') DEFAULT 'pending',
  payment_method VARCHAR(50),
  shipping_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_user (user_id, status),
  INDEX idx_order_no (order_no),
  INDEX idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE order_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  
  INDEX idx_order (order_id),
  INDEX idx_product (product_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
```

### 3. 软删除
```sql
-- 软删除：不真删除，打标记
CREATE TABLE posts (
  id BIGINT PRIMARY KEY,
  title VARCHAR(200),
  content TEXT,
  deleted_at TIMESTAMP NULL,  -- NULL表示未删除
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_deleted (deleted_at)
);

-- 查询时过滤已删除
SELECT * FROM posts WHERE deleted_at IS NULL;

-- 删除操作改为更新
UPDATE posts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?;

-- 真删除（定期清理）
DELETE FROM posts WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
```

### 4. 乐观锁（并发控制）
```sql
CREATE TABLE products (
  id BIGINT PRIMARY KEY,
  name VARCHAR(100),
  stock INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 0,  -- 版本号
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 更新库存（带版本检查）
UPDATE products 
SET stock = stock - 1, version = version + 1
WHERE id = ? AND version = ? AND stock > 0;

-- 受影响行数为0说明冲突，需要重试
```

## 数据库设计检查清单

- [ ] 表名和字段名符合命名规范
- [ ] 主键使用BIGINT AUTO_INCREMENT
- [ ] 外键有ON DELETE/ON UPDATE规则
- [ ] 字段类型选择合理（金额用DECIMAL）
- [ ] 必备字段：id, created_at, updated_at
- [ ] 考虑软删除（deleted_at）
- [ ] WHERE/JOIN字段有索引
- [ ] 复合索引遵循最左前缀
- [ ] 避免过度索引（影响写性能）
- [ ] 敏感数据加密存储
- [ ] 有数据备份策略

## 使用示例

1. 分析业务需求，识别实体和关系
2. 设计ER图（实体关系图）
3. 按三范式设计表结构
4. 根据查询需求适当反范式化
5. 添加必要的索引
6. 编写常用查询SQL并优化
7. 评审性能和扩展性
