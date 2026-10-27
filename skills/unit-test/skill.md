---
name: unit-test
description: 编写高质量的单元测试，覆盖核心逻辑的正常情况、边界值和异常场景，确保代码可靠性
builtin: true
---

# 单元测试技能

## 描述
编写高质量的单元测试，覆盖核心逻辑的正常情况、边界值和异常场景，确保代码可靠性。

## 测试原则

### 1. 好的单元测试特征 (FIRST)
- **Fast**: 快速运行，毫秒级完成
- **Independent**: 测试间相互独立，顺序无关
- **Repeatable**: 可重复执行，结果稳定
- **Self-validating**: 自动判断通过/失败，无需人工检查
- **Timely**: 及时编写，理想情况下与代码同步

### 2. 测试覆盖策略
- **正常路径**: 典型的有效输入和预期输出
- **边界值**: 0, 空字符串, null, undefined, 最大最小值
- **异常情况**: 无效输入、错误状态、异常抛出
- **边缘场景**: 并发、大数据量、网络失败

### 3. AAA模式
每个测试分三部分：
```javascript
test('用户名验证 - 拒绝过短的用户名', () => {
  // Arrange - 准备测试数据
  const username = 'ab';
  
  // Act - 执行被测试的操作
  const result = validateUsername(username);
  
  // Assert - 验证结果
  expect(result.valid).toBe(false);
  expect(result.error).toBe('用户名至少3个字符');
});
```

## 常用测试框架

### JavaScript/TypeScript
- **Jest**: 最流行，开箱即用
- **Mocha + Chai**: 灵活组合
- **Vitest**: 更快的Jest替代品

### Python
- **pytest**: 最推荐
- **unittest**: 标准库

### Java
- **JUnit 5**: 标准选择
- **Mockito**: Mock框架

## 测试示例

### 示例1: 函数测试
```javascript
// 被测函数
function calculateDiscount(price, userLevel) {
  if (price < 0) throw new Error('价格不能为负数');
  if (userLevel === 'vip') return price * 0.8;
  if (userLevel === 'premium') return price * 0.9;
  return price;
}

// 测试用例
describe('calculateDiscount', () => {
  test('VIP用户获得20%折扣', () => {
    expect(calculateDiscount(100, 'vip')).toBe(80);
  });
  
  test('Premium用户获得10%折扣', () => {
    expect(calculateDiscount(100, 'premium')).toBe(90);
  });
  
  test('普通用户无折扣', () => {
    expect(calculateDiscount(100, 'normal')).toBe(100);
  });
  
  test('价格为0时正确处理', () => {
    expect(calculateDiscount(0, 'vip')).toBe(0);
  });
  
  test('负数价格抛出错误', () => {
    expect(() => calculateDiscount(-10, 'vip')).toThrow('价格不能为负数');
  });
});
```

### 示例2: 异步测试
```javascript
// 被测函数
async function fetchUser(userId) {
  const response = await fetch(`/api/users/${userId}`);
  if (!response.ok) throw new Error('用户不存在');
  return response.json();
}

// 测试用例
describe('fetchUser', () => {
  test('成功获取用户信息', async () => {
    global.fetch = jest.fn(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'John' })
      })
    );
    
    const user = await fetchUser(1);
    expect(user).toEqual({ id: 1, name: 'John' });
    expect(fetch).toHaveBeenCalledWith('/api/users/1');
  });
  
  test('用户不存在时抛出错误', async () => {
    global.fetch = jest.fn(() => 
      Promise.resolve({ ok: false })
    );
    
    await expect(fetchUser(999)).rejects.toThrow('用户不存在');
  });
});
```

### 示例3: Mock依赖
```javascript
// 被测类
class OrderService {
  constructor(database, emailService) {
    this.db = database;
    this.email = emailService;
  }
  
  async createOrder(userId, items) {
    const order = await this.db.orders.create({ userId, items });
    await this.email.send(userId, '订单创建成功');
    return order;
  }
}

// 测试用例
describe('OrderService', () => {
  test('创建订单并发送邮件', async () => {
    // Mock依赖
    const mockDb = {
      orders: {
        create: jest.fn().mockResolvedValue({ id: 123, userId: 1 })
      }
    };
    const mockEmail = {
      send: jest.fn().mockResolvedValue(true)
    };
    
    const service = new OrderService(mockDb, mockEmail);
    const order = await service.createOrder(1, ['item1', 'item2']);
    
    // 验证数据库调用
    expect(mockDb.orders.create).toHaveBeenCalledWith({
      userId: 1,
      items: ['item1', 'item2']
    });
    
    // 验证邮件发送
    expect(mockEmail.send).toHaveBeenCalledWith(1, '订单创建成功');
    
    // 验证返回值
    expect(order).toEqual({ id: 123, userId: 1 });
  });
});
```

## 测试用例设计技巧

### 1. 等价类划分
将输入分为有效和无效两大类：
- 有效输入: 正常情况
- 无效输入: 各种错误情况

### 2. 边界值分析
重点测试边界：
```javascript
// 测试字符串长度限制 (3-20字符)
test('长度为3的用户名有效', () => {...});
test('长度为2的用户名无效', () => {...});
test('长度为20的用户名有效', () => {...});
test('长度为21的用户名无效', () => {...});
```

### 3. 决策表
多个条件组合的测试：
```javascript
// 登录逻辑: 用户名正确 && 密码正确 && 未锁定
test('所有条件满足，登录成功', () => {...});
test('用户名错误，登录失败', () => {...});
test('密码错误，登录失败', () => {...});
test('账号锁定，登录失败', () => {...});
```

## 测试命名规范

### 格式：被测对象_测试场景_预期结果
```javascript
// ✓ 清晰描述
test('validateEmail_空字符串_返回错误', () => {...});
test('calculateTotal_购物车为空_返回0', () => {...});
test('loginUser_密码错误_抛出异常', () => {...});

// ✗ 模糊不清
test('test1', () => {...});
test('验证功能', () => {...});
```

### 中文命名（更直观）
```javascript
describe('用户注册', () => {
  test('用户名已存在时返回错误', () => {...});
  test('邮箱格式无效时返回错误', () => {...});
  test('所有信息有效时创建成功', () => {...});
});
```

## Mock策略

### 何时Mock？
- **外部依赖**: 数据库、API、文件系统、时间
- **慢操作**: 网络请求、复杂计算
- **不稳定**: 随机数、第三方服务

### 何时不Mock？
- 被测试的主要逻辑
- 简单的工具函数
- 数据结构操作

### Mock示例
```javascript
// Mock时间
jest.useFakeTimers();
jest.setSystemTime(new Date('2024-01-15'));

// Mock随机数
jest.spyOn(Math, 'random').mockReturnValue(0.5);

// Mock环境变量
process.env.NODE_ENV = 'test';
```

## 测试覆盖率目标

- **核心业务逻辑**: 90%+
- **工具函数**: 80%+
- **UI组件**: 60%+（重点测交互逻辑）

不追求100%覆盖率，而是覆盖关键路径和容易出错的地方。

## 常见错误

### ❌ 测试实现细节
```javascript
// 不好：测试内部实现
test('调用了辅助函数', () => {
  const spy = jest.spyOn(module, 'helperFunction');
  doSomething();
  expect(spy).toHaveBeenCalled();
});
```

### ✓ 测试行为结果
```javascript
// 好：测试最终结果
test('返回正确的计算结果', () => {
  const result = doSomething();
  expect(result).toBe(expectedValue);
});
```

### ❌ 测试间相互依赖
```javascript
let userId;
test('创建用户', () => {
  userId = createUser(); // 后续测试依赖这个ID
});
test('删除用户', () => {
  deleteUser(userId); // 依赖上一个测试
});
```

### ✓ 每个测试独立
```javascript
test('创建用户', () => {
  const userId = createUser();
  expect(userId).toBeDefined();
  cleanup(userId); // 自己清理
});
test('删除用户', () => {
  const userId = createUser(); // 自己准备数据
  deleteUser(userId);
  expect(getUser(userId)).toBeNull();
});
```

## 测试清单

- [ ] 核心功能都有测试
- [ ] 边界值都覆盖
- [ ] 异常情况有测试
- [ ] 测试命名清晰
- [ ] 测试独立运行
- [ ] Mock了外部依赖
- [ ] 断言具体明确
- [ ] 运行速度快（<1秒）

## 使用示例

1. 分析被测代码的输入输出
2. 列出正常、边界、异常场景
3. 按AAA模式编写测试
4. Mock外部依赖
5. 运行测试并查看覆盖率
6. 补充遗漏的场景
