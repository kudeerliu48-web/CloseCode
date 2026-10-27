---
name: refactor-guide
description: 系统化地改进代码结构和质量，识别代码坏味道并应用重构技法，使代码更清晰易维护
builtin: true
---

# 代码重构技能

## 描述
系统化地改进代码结构和质量，在不改变外部行为的前提下，使代码更清晰、更易维护、更高效。

## 重构原则

### 何时重构？
- 添加新功能前，先重构使其更易扩展
- 修复Bug后，重构避免类似问题
- 代码审查时发现问题
- 看到"代码坏味道"时

### 何时不重构？
- 代码能工作且短期不会再改
- 重写比重构更快
- 临近发布截止日期

### 安全重构的前提
- ✅ 有测试覆盖
- ✅ 使用版本控制
- ✅ 小步前进，频繁提交
- ✅ 重构与功能开发分离

## 常见代码坏味道

### 1. 长函数 (Long Method)
**问题**: 函数超过50行，难以理解

**重构**: 提取函数
```javascript
// ❌ 重构前
function processOrder(order) {
  // 验证订单（20行）
  if (!order.userId) return { error: 'userId required' };
  if (!order.items || order.items.length === 0) return { error: 'items required' };
  // ... 更多验证
  
  // 计算总价（15行）
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.quantity;
  }
  // ... 折扣计算
  
  // 保存订单（10行）
  const savedOrder = db.orders.create(order);
  // ... 更多保存逻辑
  
  return savedOrder;
}

// ✅ 重构后
function processOrder(order) {
  const validation = validateOrder(order);
  if (!validation.valid) return { error: validation.error };
  
  const total = calculateTotal(order.items);
  const finalOrder = { ...order, total };
  
  return saveOrder(finalOrder);
}

function validateOrder(order) {
  if (!order.userId) return { valid: false, error: 'userId required' };
  if (!order.items?.length) return { valid: false, error: 'items required' };
  return { valid: true };
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function saveOrder(order) {
  return db.orders.create(order);
}
```

### 2. 重复代码 (Duplicated Code)
**问题**: 相同或相似代码出现多次

**重构**: 提取公共函数
```javascript
// ❌ 重构前
function getActiveUsers() {
  return db.users.find({ status: 'active', deletedAt: null });
}

function getActiveAdmins() {
  return db.users.find({ role: 'admin', status: 'active', deletedAt: null });
}

// ✅ 重构后
function getUsers(filters = {}) {
  return db.users.find({ 
    status: 'active', 
    deletedAt: null, 
    ...filters 
  });
}

function getActiveUsers() {
  return getUsers();
}

function getActiveAdmins() {
  return getUsers({ role: 'admin' });
}
```

### 3. 过长参数列表 (Long Parameter List)
**问题**: 函数参数超过3个，难以记忆和调用

**重构**: 引入参数对象
```javascript
// ❌ 重构前
function createUser(username, email, password, age, country, city, phone) {
  // ...
}
createUser('john', 'john@example.com', 'pass123', 25, 'US', 'NYC', '123456');

// ✅ 重构后
function createUser({ username, email, password, age, country, city, phone }) {
  // ...
}
createUser({
  username: 'john',
  email: 'john@example.com',
  password: 'pass123',
  age: 25,
  country: 'US',
  city: 'NYC',
  phone: '123456'
});
```

### 4. 过大的类 (Large Class)
**问题**: 类职责过多，代码膨胀

**重构**: 拆分类
```javascript
// ❌ 重构前
class User {
  // 用户基本信息
  constructor(username, email) { /*...*/ }
  
  // 认证相关
  login() { /*...*/ }
  logout() { /*...*/ }
  resetPassword() { /*...*/ }
  
  // 订单相关
  createOrder() { /*...*/ }
  cancelOrder() { /*...*/ }
  getOrders() { /*...*/ }
  
  // 支付相关
  addPaymentMethod() { /*...*/ }
  pay() { /*...*/ }
}

// ✅ 重构后
class User {
  constructor(username, email) { /*...*/ }
}

class AuthService {
  login(user) { /*...*/ }
  logout(user) { /*...*/ }
  resetPassword(user) { /*...*/ }
}

class OrderService {
  createOrder(user, items) { /*...*/ }
  cancelOrder(orderId) { /*...*/ }
  getUserOrders(userId) { /*...*/ }
}

class PaymentService {
  addPaymentMethod(user, method) { /*...*/ }
  processPayment(order, method) { /*...*/ }
}
```

### 5. 魔法数字 (Magic Numbers)
**问题**: 硬编码的数字，含义不明

**重构**: 命名常量
```javascript
// ❌ 重构前
if (user.age < 18) {
  return '未成年';
}
if (order.total > 1000) {
  discount = order.total * 0.1;
}

// ✅ 重构后
const ADULT_AGE = 18;
const VIP_THRESHOLD = 1000;
const VIP_DISCOUNT_RATE = 0.1;

if (user.age < ADULT_AGE) {
  return '未成年';
}
if (order.total > VIP_THRESHOLD) {
  discount = order.total * VIP_DISCOUNT_RATE;
}
```

### 6. 复杂的条件表达式 (Complex Conditional)
**问题**: 嵌套的if-else难以理解

**重构**: 提前返回 + 提取条件函数
```javascript
// ❌ 重构前
function calculateShipping(order) {
  let cost;
  if (order.total > 100) {
    if (order.weight < 5) {
      cost = 0;
    } else {
      cost = 10;
    }
  } else {
    if (order.weight < 5) {
      cost = 5;
    } else {
      cost = 15;
    }
  }
  return cost;
}

// ✅ 重构后
function calculateShipping(order) {
  if (isFreeShipping(order)) return 0;
  if (isHeavyOrder(order)) return order.total > 100 ? 10 : 15;
  return 5;
}

function isFreeShipping(order) {
  return order.total > 100 && order.weight < 5;
}

function isHeavyOrder(order) {
  return order.weight >= 5;
}
```

### 7. 临时变量过多 (Temporary Field)
**问题**: 中间变量太多，增加理解负担

**重构**: 内联变量或链式调用
```javascript
// ❌ 重构前
function processData(data) {
  const filtered = data.filter(item => item.active);
  const mapped = filtered.map(item => item.value);
  const summed = mapped.reduce((a, b) => a + b, 0);
  const result = summed / mapped.length;
  return result;
}

// ✅ 重构后
function processData(data) {
  const values = data
    .filter(item => item.active)
    .map(item => item.value);
  return values.reduce((a, b) => a + b, 0) / values.length;
}
```

### 8. 注释过多 (Comments Everywhere)
**问题**: 代码需要注释才能理解

**重构**: 让代码自解释
```javascript
// ❌ 重构前
// 检查用户是否有权限访问资源
if (user.role === 'admin' || (user.id === resource.ownerId && !resource.locked)) {
  // 允许访问
}

// ✅ 重构后
function canAccessResource(user, resource) {
  return user.role === 'admin' || isOwnerAndNotLocked(user, resource);
}

function isOwnerAndNotLocked(user, resource) {
  return user.id === resource.ownerId && !resource.locked;
}

if (canAccessResource(user, resource)) {
  // 允许访问
}
```

## 重构技法目录

### 提取相关
- **提取函数**: 长函数 → 小函数
- **提取变量**: 复杂表达式 → 命名变量
- **提取类**: 大类 → 多个小类

### 内联相关
- **内联函数**: 过度封装的简单函数
- **内联变量**: 只用一次的临时变量

### 移动相关
- **搬移函数**: 函数放到更合适的类
- **搬移字段**: 字段移到更合适的类

### 条件逻辑
- **分解条件表达式**: 复杂条件 → 命名函数
- **合并条件表达式**: 相同结果的多个条件
- **以卫语句取代嵌套条件**: 提前返回

### 简化接口
- **引入参数对象**: 多个参数 → 对象
- **保持对象完整**: 传对象而不是字段
- **以查询取代参数**: 参数可由接收方计算

## 重构步骤示例

### 步骤1: 识别坏味道
```javascript
// 发现问题：函数过长、重复代码、魔法数字
function checkout(cart) {
  if (cart.items.length === 0) return { error: 'empty cart' };
  let total = 0;
  for (const item of cart.items) {
    total += item.price * item.quantity;
  }
  if (total > 1000) {
    total = total * 0.9;
  }
  if (cart.userId) {
    const user = db.users.findOne({ id: cart.userId });
    if (user.vip) {
      total = total * 0.95;
    }
  }
  return { total };
}
```

### 步骤2: 写测试（如果没有）
```javascript
test('空购物车返回错误', () => {
  expect(checkout({ items: [] })).toEqual({ error: 'empty cart' });
});

test('计算总价', () => {
  const cart = { items: [{ price: 100, quantity: 2 }] };
  expect(checkout(cart).total).toBe(200);
});

test('大额订单打9折', () => {
  const cart = { items: [{ price: 1000, quantity: 2 }] };
  expect(checkout(cart).total).toBe(1800);
});
```

### 步骤3: 小步重构
```javascript
// 重构1: 提取常量
const LARGE_ORDER_THRESHOLD = 1000;
const LARGE_ORDER_DISCOUNT = 0.9;
const VIP_DISCOUNT = 0.95;

// 重构2: 提取计算总价函数
function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

// 重构3: 提取折扣计算
function applyDiscounts(total, cart) {
  let finalTotal = total;
  
  if (total > LARGE_ORDER_THRESHOLD) {
    finalTotal *= LARGE_ORDER_DISCOUNT;
  }
  
  if (cart.userId) {
    const user = db.users.findOne({ id: cart.userId });
    if (user?.vip) {
      finalTotal *= VIP_DISCOUNT;
    }
  }
  
  return finalTotal;
}

// 重构后的主函数
function checkout(cart) {
  if (cart.items.length === 0) {
    return { error: 'empty cart' };
  }
  
  const total = calculateTotal(cart.items);
  const finalTotal = applyDiscounts(total, cart);
  
  return { total: finalTotal };
}
```

### 步骤4: 运行测试确保无破坏
```bash
npm test
# 所有测试通过 ✓
```

### 步骤5: 提交
```bash
git add .
git commit -m "refactor: 重构checkout函数，提取常量和子函数"
```

## 重构检查清单

- [ ] 重构前有测试覆盖
- [ ] 每次重构小步进行
- [ ] 每步后运行测试
- [ ] 频繁提交
- [ ] 没有改变外部行为
- [ ] 代码更清晰易读
- [ ] 函数不超过30行
- [ ] 参数不超过3个
- [ ] 无重复代码
- [ ] 无魔法数字

## 重构优先级

1. **Critical**: 影响功能正确性的坏味道（复杂条件、重复逻辑）
2. **High**: 严重影响可维护性（长函数、大类）
3. **Medium**: 影响可读性（魔法数字、命名不清）
4. **Low**: 微小优化（变量顺序、空行）

## 使用示例

1. 识别代码坏味道
2. 确保有测试覆盖
3. 选择合适的重构技法
4. 小步重构，频繁运行测试
5. 每完成一个重构就提交
6. 重复直到代码清晰
